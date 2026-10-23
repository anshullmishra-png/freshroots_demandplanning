import { and, desc, eq, gte, lte, ne } from "drizzle-orm";
import { lossEntries } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { parseIsoDate } from "@/lib/dates/isoWeek";
import { deliverAfterCommit } from "@/lib/email";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { evaluateKill2AndAct, type Kill2Outcome } from "@/lib/kill/service";
import { quarterOf } from "@/lib/kill/logic";
import { writeAudit } from "./audit";

export interface LossInput {
  periodStart: string;
  periodEnd: string;
  stockoutLossRupees: number;
  overstockWriteoffRupees: number;
  note: string | null;
}

const MAX_RUPEES = 10_000_000_000; // 1,000 crore: far beyond any real quarter, well inside numeric(14,2)

function amount(value: unknown, field: string): number {
  if (typeof value !== "number" || !Number.isFinite(value) || value < 0 || value > MAX_RUPEES) {
    throw badRequest("BAD_AMOUNT", `${field} must be a number of rupees, 0 or more.`);
  }
  if (Math.abs(Math.round(value * 100) - value * 100) > 1e-6) {
    throw badRequest("BAD_AMOUNT", `${field} can have at most 2 decimal places.`);
  }
  return Math.round(value * 100) / 100;
}

/** Checks Priya's form. One entry sits inside one calendar quarter, so no entry can straddle two (open question 41). */
export function parseLossInput(body: unknown, rules: RulesConfig = loadRules()): LossInput {
  if (typeof body !== "object" || body === null) throw badRequest("BAD_BODY", "Send a JSON object.");
  const b = body as Record<string, unknown>;
  const start = typeof b.periodStart === "string" ? b.periodStart : "";
  const end = typeof b.periodEnd === "string" ? b.periodEnd : "";
  if (!parseIsoDate(start) || !parseIsoDate(end)) throw badRequest("BAD_DATE", "periodStart and periodEnd must be real dates like 2026-10-31.");
  if (start > end) throw badRequest("BAD_PERIOD", "The period cannot end before it starts.");
  const startMonth = rules.kill_switch_2.quarter_start_month;
  if (quarterOf(start, startMonth).label !== quarterOf(end, startMonth).label) {
    throw badRequest("SPLIT_AT_QUARTER", "A period must sit inside one quarter. Enter the part before the quarter end and the part after it as two entries.");
  }
  const note = typeof b.note === "string" && b.note.trim() !== "" ? b.note.trim() : null;
  if (note !== null && note.length > 500) throw badRequest("NOTE_TOO_LONG", "The note is at most 500 characters.");
  return {
    periodStart: start,
    periodEnd: end,
    stockoutLossRupees: amount(b.stockoutLossRupees, "stockoutLossRupees"),
    overstockWriteoffRupees: amount(b.overstockWriteoffRupees, "overstockWriteoffRupees"),
    note,
  };
}

export interface LossResult {
  id: number;
  /** Other entries that overlap this period: possible double counting, for Priya to check. */
  overlaps: number[];
  kill2: Kill2Outcome;
}

async function overlapping(tx: AnyDb, input: LossInput, exceptId?: number): Promise<number[]> {
  const rows = await tx
    .select({ id: lossEntries.id })
    .from(lossEntries)
    .where(and(lte(lossEntries.periodStart, input.periodEnd), gte(lossEntries.periodEnd, input.periodStart), exceptId ? ne(lossEntries.id, exceptId) : undefined));
  return rows.map((r) => r.id);
}

async function assertPeriodFree(tx: AnyDb, input: LossInput, exceptId?: number): Promise<void> {
  const same = await tx
    .select({ id: lossEntries.id })
    .from(lossEntries)
    .where(and(eq(lossEntries.periodStart, input.periodStart), eq(lossEntries.periodEnd, input.periodEnd), exceptId ? ne(lossEntries.id, exceptId) : undefined))
    .limit(1);
  if (same.length > 0) throw conflict("DUPLICATE_PERIOD", `An entry for ${input.periodStart} to ${input.periodEnd} already exists. Edit it instead.`);
}

/** Saves a loss entry, then checks Kill 2 in the same transaction (G-K1). Emails go out after commit. */
export async function createLossEntry(db: AnyDb, actor: SessionUser, body: unknown, opts: { rules?: RulesConfig; now?: Date } = {}): Promise<LossResult> {
  assertCan(actor.role, "enter_loss");
  const rules = opts.rules ?? loadRules();
  const input = parseLossInput(body, rules);
  const result = await db.transaction(async (tx) => {
    await assertPeriodFree(tx, input);
    const overlaps = await overlapping(tx, input);
    const [row] = await tx
      .insert(lossEntries)
      .values({ ...input, enteredBy: actor.id })
      .returning({ id: lossEntries.id });
    await writeAudit(tx, { actorId: actor.id, action: "loss_entry.created", entity: "loss_entry", entityId: row.id, after: { ...input, overlaps } });
    const kill2 = await evaluateKill2AndAct(tx, { rules, now: opts.now });
    return { id: row.id, overlaps, kill2 };
  });
  if (result.kill2.eventId) await deliverAfterCommit(db);
  return result;
}

/** Corrects an entry. The before and after are kept in the audit log, and Kill 2 is checked again (G-K1). */
export async function updateLossEntry(db: AnyDb, actor: SessionUser, id: number, body: unknown, opts: { rules?: RulesConfig; now?: Date } = {}): Promise<LossResult> {
  assertCan(actor.role, "enter_loss");
  const rules = opts.rules ?? loadRules();
  const input = parseLossInput(body, rules);
  const result = await db.transaction(async (tx) => {
    const [before] = await tx.select().from(lossEntries).where(eq(lossEntries.id, id)).limit(1);
    if (!before) throw notFound(`Loss entry ${id} does not exist.`);
    await assertPeriodFree(tx, input, id);
    const overlaps = await overlapping(tx, input, id);
    await tx.update(lossEntries).set({ ...input, updatedBy: actor.id, updatedAt: new Date() }).where(eq(lossEntries.id, id));
    await writeAudit(tx, {
      actorId: actor.id,
      action: "loss_entry.updated",
      entity: "loss_entry",
      entityId: id,
      before: {
        periodStart: before.periodStart,
        periodEnd: before.periodEnd,
        stockoutLossRupees: before.stockoutLossRupees,
        overstockWriteoffRupees: before.overstockWriteoffRupees,
        note: before.note,
      },
      after: { ...input, overlaps },
    });
    const kill2 = await evaluateKill2AndAct(tx, { rules, now: opts.now });
    return { id, overlaps, kill2 };
  });
  if (result.kill2.eventId) await deliverAfterCommit(db);
  return result;
}

export async function listLossEntries(db: AnyDb) {
  return db.select().from(lossEntries).orderBy(desc(lossEntries.periodStart), desc(lossEntries.id));
}
