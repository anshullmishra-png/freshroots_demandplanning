import { and, count, desc, eq, gte, inArray, lte, ne, sql } from "drizzle-orm";
import { aiDecisions, auditLog, buyingDecisions, emailOutbox, killEvents, killState, lossEntries, reviews, runs, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan, type Role } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { formatWeek, isoWeekOf, istDate, parseIsoDate } from "@/lib/dates/isoWeek";
import { AppError, badRequest, conflict } from "@/lib/errors";
import { writeAudit } from "@/lib/workflow/audit";
import { STOP_MESSAGE, evaluateKill1, evaluateKill2, formatLakhs, formatRupees, quarterOf, type Kill1Result, type Kill2Band, type Quarter } from "./logic";

// Who is told. docs/06: an alert goes to Raghav, Deepa and the CEO; a kill also goes to Priya.
export const ALERT_RECIPIENTS: Role[] = ["raghav", "deepa", "ceo"];
export const KILL_RECIPIENTS: Role[] = ["raghav", "deepa", "ceo", "priya"];

export const MIN_REARM_REASON = 20;

interface Opts {
  rules?: RulesConfig;
  now?: Date;
}

/** Locks the single state row for the rest of the transaction, creating it if it is somehow missing. */
async function lockState(tx: AnyDb) {
  await tx.insert(killState).values({ id: 1 }).onConflictDoNothing();
  const [state] = await tx.select().from(killState).where(eq(killState.id, 1)).for("update");
  return state;
}

export async function readKillState(db: AnyDb) {
  const [state] = await db.select().from(killState).where(eq(killState.id, 1)).limit(1);
  return state ?? null;
}

/** Cheap check used before any new run or AI call. */
export async function automationStopped(db: AnyDb): Promise<{ stopped: boolean; which: Array<1 | 2> }> {
  const s = await readKillState(db);
  const which: Array<1 | 2> = [];
  if (s?.kill1State === "killed") which.push(1);
  if (s?.kill2State === "killed") which.push(2);
  return { stopped: which.length > 0, which };
}

/** New runs and the AI step are blocked the moment a kill fires (G-K2). */
export async function assertAutomationRunning(db: AnyDb): Promise<void> {
  const { stopped, which } = await automationStopped(db);
  if (stopped) {
    throw new AppError(409, "AUTOMATION_STOPPED", which.map((w) => STOP_MESSAGE(w)).join(" "), { kill: which });
  }
}

export async function killStateLabel(db: AnyDb): Promise<string> {
  const s = await readKillState(db);
  return s ? `kill1:${s.kill1State};kill2:${s.kill2State}` : "kill1:armed;kill2:green";
}

// ---------------------------------------------------------------------------------------------------------
// Counting

/** Reviewed non-fallback AI decisions since the epoch, and how many of them Raghav reversed. */
export async function kill1Counts(db: AnyDb, epochStart: Date): Promise<{ reviewed: number; reversed: number }> {
  const [row] = await db
    .select({
      reviewed: count(),
      reversed: sql<number>`count(*) filter (where ${reviews.outcome} = 'rejected')`.mapWith(Number),
    })
    .from(aiDecisions)
    .innerJoin(reviews, eq(reviews.aiDecisionId, aiDecisions.id))
    .where(and(eq(aiDecisions.isFallback, false), eq(aiDecisions.valid, true), gte(reviews.reviewedAt, epochStart)));
  return { reviewed: row.reviewed, reversed: row.reversed };
}

export interface QuarterLoss {
  quarter: Quarter;
  stockout: number;
  overstock: number;
  total: number;
  entries: number;
}

/** Sum of every loss entry that falls inside the quarter (docs/06: quarter_to_date_loss). */
export async function quarterLoss(db: AnyDb, quarter: Quarter): Promise<QuarterLoss> {
  const [row] = await db
    .select({
      stockout: sql<number>`coalesce(sum(${lossEntries.stockoutLossRupees}), 0)`.mapWith(Number),
      overstock: sql<number>`coalesce(sum(${lossEntries.overstockWriteoffRupees}), 0)`.mapWith(Number),
      entries: count(),
    })
    .from(lossEntries)
    .where(and(gte(lossEntries.periodStart, quarter.start), lte(lossEntries.periodEnd, quarter.end)));
  const stockout = Math.round(row.stockout * 100) / 100;
  const overstock = Math.round(row.overstock * 100) / 100;
  return { quarter, stockout, overstock, total: Math.round((stockout + overstock) * 100) / 100, entries: row.entries };
}

// ---------------------------------------------------------------------------------------------------------
// Actions

async function queueEmails(
  tx: AnyDb,
  roles: Role[],
  kind: string,
  subject: string,
  body: string,
  killEventId: number | null,
): Promise<number> {
  const recipients = await tx.select({ email: users.email, name: users.name }).from(users).where(and(inArray(users.role, roles), eq(users.active, true)));
  if (recipients.length === 0) return 0;
  await tx.insert(emailOutbox).values(recipients.map((r) => ({ toEmail: r.email, toName: r.name, subject, body, kind, killEventId })));
  return recipients.length;
}

/**
 * What "killed" does (docs/06): unreviewed AI decisions are voided, orders not yet placed are held (never cancelled),
 * and reviews still open are blocked. New runs and the AI step are refused by `assertAutomationRunning`.
 */
async function stopAutomation(tx: AnyDb): Promise<{ voided: number; held: number; blockedRuns: number }> {
  const voided = await tx.update(aiDecisions).set({ status: "voided_by_kill" }).where(eq(aiDecisions.status, "pending_review")).returning({ id: aiDecisions.id });
  const held = await tx
    .update(buyingDecisions)
    .set({ status: "held" })
    .where(and(eq(buyingDecisions.status, "pending"), ne(buyingDecisions.action, "NO_ACTION")))
    .returning({ id: buyingDecisions.id });
  const blocked = await tx.update(runs).set({ status: "blocked" }).where(eq(runs.status, "in_review")).returning({ id: runs.id });
  return { voided: voided.length, held: held.length, blockedRuns: blocked.length };
}

const appLink = (path: string) => `${process.env.APP_URL ?? ""}${path}`;

export interface Kill1Outcome {
  fired: boolean;
  alreadyKilled: boolean;
  result: Kill1Result;
  eventId: number | null;
}

/**
 * KILL 1. Run after every review is saved (G-K1), inside the same transaction as the review. Idempotent: once
 * killed it does nothing more until re-armed, so two evaluations create one event.
 */
export async function evaluateKill1AndAct(db: AnyDb, opts: Opts = {}): Promise<Kill1Outcome> {
  const rules = opts.rules ?? loadRules();
  return db.transaction(async (tx) => {
    const state = await lockState(tx);
    const result = evaluateKill1(await kill1Counts(tx, state.kill1EpochStart), rules.kill_switch_1);
    if (state.kill1State === "killed") return { fired: false, alreadyKilled: true, result, eventId: null };
    if (result.verdict !== "kill") return { fired: false, alreadyKilled: false, result, eventId: null };

    await tx.update(killState).set({ kill1State: "killed", updatedAt: new Date() }).where(eq(killState.id, 1));
    const stopped = await stopAutomation(tx);
    const [event] = await tx
      .insert(killEvents)
      .values({
        killSwitch: 1,
        event: "killed",
        metricValue: result.ratePct ?? 0,
        threshold: result.thresholdPct,
        detailsJson: { reviewed: result.reviewed, reversed: result.reversed, epochStart: state.kill1EpochStart, ...stopped },
      })
      .returning({ id: killEvents.id });
    await writeAudit(tx, { actorId: null, action: "kill1.fired", entity: "kill_switch", entityId: 1, after: { ...result, ...stopped } });
    const pct = (result.ratePct ?? 0).toFixed(1);
    await queueEmails(
      tx,
      KILL_RECIPIENTS,
      "kill1.killed",
      "Freshroots automation stopped (Kill 1)",
      `${STOP_MESSAGE(1)}\n\nRaghav reversed ${result.reversed} of ${result.reviewed} reviewed AI decisions (${pct}%). The limit is ${result.thresholdPct}% once at least ${result.minReviewed} have been reviewed.\n\nUnreviewed decisions were voided (${stopped.voided}) and unplaced orders held (${stopped.held}). Nothing was cancelled.\n\nOpen the app: ${appLink("/kill")}`,
      event.id,
    );
    return { fired: true, alreadyKilled: false, result, eventId: event.id };
  });
}

export interface Kill2Outcome {
  state: Kill2Band;
  band: Kill2Band;
  changed: boolean;
  total: number;
  eventId: number | null;
}

/**
 * KILL 2. Run after every loss entry is saved or edited, and once a day by cron (rollovers). Idempotent: it only
 * acts when the band changes, so two evaluations create one event. A killed state never resets by itself, not even at
 * a quarter rollover; it needs a re-arm.
 */
export async function evaluateKill2AndAct(db: AnyDb, opts: Opts = {}): Promise<Kill2Outcome> {
  const rules = opts.rules ?? loadRules();
  const cfg = rules.kill_switch_2;
  const today = istDate(opts.now ?? new Date());
  return db.transaction(async (tx) => {
    const state = await lockState(tx);
    const loss = await quarterLoss(tx, quarterOf(today, cfg.quarter_start_month));
    const band = evaluateKill2(loss.total, cfg);
    const noChange = { state: state.kill2State, band, changed: false, total: loss.total, eventId: null };
    if (state.kill2State === "killed" || band === state.kill2State) return noChange;

    await tx.update(killState).set({ kill2State: band, updatedAt: new Date() }).where(eq(killState.id, 1));
    const detail = { quarter: loss.quarter.label, stockout: loss.stockout, overstock: loss.overstock, total: loss.total };

    if (band === "green") {
      // The quarter rolled over or an entry was corrected: back to green, quietly but on the record.
      await writeAudit(tx, { actorId: null, action: "kill2.cleared", entity: "kill_switch", entityId: 2, before: { state: state.kill2State }, after: detail });
      return { state: band, band, changed: true, total: loss.total, eventId: null };
    }

    const killed = band === "killed";
    const [event] = await tx
      .insert(killEvents)
      .values({
        killSwitch: 2,
        event: killed ? "killed" : "alert",
        metricValue: loss.total,
        threshold: killed ? cfg.kill_above_rupees : cfg.alert_above_rupees,
        detailsJson: detail,
      })
      .returning({ id: killEvents.id });
    if (killed) {
      const stopped = await stopAutomation(tx);
      await writeAudit(tx, { actorId: null, action: "kill2.fired", entity: "kill_switch", entityId: 2, after: { ...detail, ...stopped } });
      await queueEmails(
        tx,
        KILL_RECIPIENTS,
        "kill2.killed",
        "Freshroots automation stopped (Kill 2)",
        `${STOP_MESSAGE(2)}\n\nQuarter-to-date loss for ${loss.quarter.label} is ${formatRupees(loss.total)} (${formatLakhs(loss.total)}), above the kill level of ${formatRupees(cfg.kill_above_rupees)}.\n\nUnreviewed decisions were voided (${stopped.voided}) and unplaced orders held (${stopped.held}). Nothing was cancelled.\n\nOpen the app: ${appLink("/kill")}`,
        event.id,
      );
    } else {
      await writeAudit(tx, { actorId: null, action: "kill2.alert", entity: "kill_switch", entityId: 2, after: detail });
      await queueEmails(
        tx,
        ALERT_RECIPIENTS,
        "kill2.alert",
        "Freshroots loss alert: monitor closely",
        `Quarter-to-date loss for ${loss.quarter.label} is ${formatRupees(loss.total)} (${formatLakhs(loss.total)}), above the alert level of ${formatRupees(cfg.alert_above_rupees)}. The kill level is ${formatRupees(cfg.kill_above_rupees)}.\n\nMonitor closely: Deepa reviews this weekly and acknowledges it in the app.\n\nOpen the app: ${appLink("/kill")}`,
        event.id,
      );
    }
    return { state: band, band, changed: true, total: loss.total, eventId: event.id };
  });
}

// ---------------------------------------------------------------------------------------------------------
// Re-arm and acknowledge

export interface RearmInput {
  which: unknown;
  reason: unknown;
  /** Required when re-arming Kill 2 while the quarter's loss is still above the kill level. */
  confirmRefire?: unknown;
}

/**
 * Only Deepa or the CEO, with a written reason (G-K3). Kill 1 restarts its count from zero and keeps the past data.
 * Kill 2 keeps every loss entry, so if the quarter is still above the kill level it will fire again on the next
 * evaluation: that needs an explicit confirmation first.
 */
export async function rearmKill(db: AnyDb, actor: SessionUser, input: RearmInput, opts: Opts = {}): Promise<{ which: 1 | 2; state: string; refireWarning: boolean }> {
  assertCan(actor.role, "rearm_kill");
  const rules = opts.rules ?? loadRules();
  if (input.which !== 1 && input.which !== 2) throw badRequest("BAD_SWITCH", "which must be 1 or 2.");
  const which = input.which;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (reason.length < MIN_REARM_REASON) throw badRequest("REASON_REQUIRED", `Write a reason of at least ${MIN_REARM_REASON} characters.`);

  return db.transaction(async (tx) => {
    const state = await lockState(tx);
    const now = opts.now ?? new Date();
    if (which === 1) {
      if (state.kill1State !== "killed") throw conflict("NOT_KILLED", "Kill 1 is not stopped.");
      const counts = await kill1Counts(tx, state.kill1EpochStart);
      await tx.update(killState).set({ kill1State: "armed", kill1EpochStart: now, updatedAt: now }).where(eq(killState.id, 1));
      await tx.insert(killEvents).values({
        killSwitch: 1,
        event: "rearmed",
        metricValue: counts.reviewed === 0 ? 0 : (counts.reversed / counts.reviewed) * 100,
        threshold: rules.kill_switch_1.reversal_rate_threshold_pct,
        detailsJson: { reason, by: actor.email, role: actor.role, previousEpochStart: state.kill1EpochStart, ...counts },
      });
      await writeAudit(tx, { actorId: actor.id, action: "kill.rearmed", entity: "kill_switch", entityId: 1, before: { state: "killed", ...counts }, after: { state: "armed", epochStart: now, reason } });
      return { which, state: "armed", refireWarning: false };
    }

    if (state.kill2State !== "killed") throw conflict("NOT_KILLED", "Kill 2 is not stopped.");
    const cfg = rules.kill_switch_2;
    const loss = await quarterLoss(tx, quarterOf(istDate(now), cfg.quarter_start_month));
    const band = evaluateKill2(loss.total, cfg);
    const refire = band === "killed";
    if (refire && input.confirmRefire !== true) {
      throw new AppError(409, "REARM_WOULD_REFIRE", `This quarter's loss (${formatRupees(loss.total)}) is still above the kill level (${formatRupees(cfg.kill_above_rupees)}). Kill 2 will fire again on the next check. Confirm to re-arm anyway.`, {
        total: loss.total,
        killAbove: cfg.kill_above_rupees,
      });
    }
    // Not "killed": the next evaluation (a loss entry or the daily check) decides, and fires again if it must.
    const next = refire ? "alert" : band;
    await tx.update(killState).set({ kill2State: next, updatedAt: now }).where(eq(killState.id, 1));
    await tx.insert(killEvents).values({
      killSwitch: 2,
      event: "rearmed",
      metricValue: loss.total,
      threshold: cfg.kill_above_rupees,
      detailsJson: { reason, by: actor.email, role: actor.role, quarter: loss.quarter.label, total: loss.total, willRefire: refire },
    });
    await writeAudit(tx, { actorId: actor.id, action: "kill.rearmed", entity: "kill_switch", entityId: 2, before: { state: "killed" }, after: { state: next, reason, willRefire: refire } });
    return { which, state: next, refireWarning: refire };
  });
}

/** Deepa's weekly acknowledgement during an alert ("monitor closely", docs/06). Once per ISO week. */
export async function acknowledgeAlert(db: AnyDb, actor: SessionUser, opts: Opts = {}): Promise<{ week: string; eventId: number }> {
  assertCan(actor.role, "ack_alert");
  const now = opts.now ?? new Date();
  const week = formatWeek(isoWeekOf(parseIsoDate(istDate(now))!));
  return db.transaction(async (tx) => {
    const state = await lockState(tx);
    if (state.kill2State !== "alert") throw conflict("NO_ALERT", "There is no alert to acknowledge.");
    const [event] = await tx.select().from(killEvents).where(and(eq(killEvents.killSwitch, 2), eq(killEvents.event, "alert"))).orderBy(desc(killEvents.id)).limit(1);
    if (!event) throw conflict("NO_ALERT", "There is no alert to acknowledge.");
    const already = await tx
      .select({ id: auditLog.id })
      .from(auditLog)
      .where(and(eq(auditLog.action, "alert.acknowledged"), sql`${auditLog.afterJson}->>'week' = ${week}`))
      .limit(1);
    if (already.length > 0) throw conflict("ALREADY_ACKNOWLEDGED", `The alert is already acknowledged for ${week}.`);
    if (!event.acknowledgedBy) {
      await tx.update(killEvents).set({ acknowledgedBy: actor.id, acknowledgedAt: now }).where(eq(killEvents.id, event.id));
    }
    await writeAudit(tx, { actorId: actor.id, action: "alert.acknowledged", entity: "kill_event", entityId: event.id, after: { week } });
    return { week, eventId: event.id };
  });
}

export interface KillEventRow {
  id: number;
  killSwitch: number;
  event: "alert" | "killed" | "rearmed";
  metricValue: number;
  threshold: number;
  details: Record<string, unknown>;
  createdAt: Date;
  acknowledgedBy: string | null;
  acknowledgedAt: Date | null;
}

/** The history of kill events, newest first. Read-only: events are never edited or deleted (G-K4). */
export async function listKillEvents(db: AnyDb, limit = 100): Promise<KillEventRow[]> {
  const rows = await db
    .select({ e: killEvents, by: users.name })
    .from(killEvents)
    .leftJoin(users, eq(users.id, killEvents.acknowledgedBy))
    .orderBy(desc(killEvents.id))
    .limit(limit);
  return rows.map(({ e, by }) => ({
    id: e.id,
    killSwitch: e.killSwitch,
    event: e.event,
    metricValue: e.metricValue,
    threshold: e.threshold,
    details: e.detailsJson as Record<string, unknown>,
    createdAt: e.createdAt,
    acknowledgedBy: by,
    acknowledgedAt: e.acknowledgedAt,
  }));
}

// ---------------------------------------------------------------------------------------------------------
// Status for the dashboard, the kill page and the banner on every page

export interface KillStatus {
  stopped: boolean;
  stoppedBy: Array<1 | 2>;
  kill1: { state: "armed" | "killed"; epochStart: Date; result: Kill1Result };
  kill2: { state: "green" | "alert" | "killed"; band: Kill2Band; loss: QuarterLoss; alertAbove: number; killAbove: number };
  /** An alert is active and nobody has acknowledged it this ISO week. */
  needsAcknowledgement: boolean;
  lastAcknowledgement: { week: string; by: string | null; at: Date } | null;
}

export async function getKillStatus(db: AnyDb, opts: Opts = {}): Promise<KillStatus> {
  const rules = opts.rules ?? loadRules();
  const now = opts.now ?? new Date();
  const today = istDate(now);
  const state = (await readKillState(db)) ?? { kill1State: "armed" as const, kill2State: "green" as const, kill1EpochStart: new Date(0) };
  const result = evaluateKill1(await kill1Counts(db, state.kill1EpochStart), rules.kill_switch_1);
  const loss = await quarterLoss(db, quarterOf(today, rules.kill_switch_2.quarter_start_month));

  const [last] = await db
    .select({ at: auditLog.createdAt, after: auditLog.afterJson, by: users.name })
    .from(auditLog)
    .leftJoin(users, eq(users.id, auditLog.actorId))
    .where(eq(auditLog.action, "alert.acknowledged"))
    .orderBy(desc(auditLog.id))
    .limit(1);
  const week = formatWeek(isoWeekOf(parseIsoDate(today)!));
  const lastWeek = (last?.after as { week?: string } | null)?.week ?? null;

  const stoppedBy: Array<1 | 2> = [];
  if (state.kill1State === "killed") stoppedBy.push(1);
  if (state.kill2State === "killed") stoppedBy.push(2);
  return {
    stopped: stoppedBy.length > 0,
    stoppedBy,
    kill1: { state: state.kill1State, epochStart: state.kill1EpochStart, result },
    kill2: {
      state: state.kill2State,
      band: evaluateKill2(loss.total, rules.kill_switch_2),
      loss,
      alertAbove: rules.kill_switch_2.alert_above_rupees,
      killAbove: rules.kill_switch_2.kill_above_rupees,
    },
    needsAcknowledgement: state.kill2State === "alert" && lastWeek !== week,
    lastAcknowledgement: last && lastWeek ? { week: lastWeek, by: last.by, at: last.at } : null,
  };
}
