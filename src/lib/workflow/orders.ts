import { and, eq, inArray } from "drizzle-orm";
import { aiDecisions, buyingDecisions, flags, reviews, runs, skus, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { daysBetween, istDate } from "@/lib/dates/isoWeek";
import { badRequest, conflict, notFound } from "@/lib/errors";
import { HELD_MESSAGE, ORDER_STATUSES, type OrderStatus } from "@/lib/orders-shared";
import { CsvSink, type BuyingDecision } from "@/lib/orders/sink";
import { writeAuditMany } from "./audit";

export interface OrderRow extends BuyingDecision {
  aiAction: "REORDER" | "PAUSE_ORDER";
  aiQuantity: number;
  runDate: string;
  dataAgeDays: number;
  placedAt: Date | null;
  placedBy: string | null;
}

export interface OrdersResult {
  /** Orders procurement must act on or has acted on, most urgent first. */
  orders: OrderRow[];
  /** Reviewed decisions that came out as "no action": nothing to order, listed for completeness. */
  noOrderNeeded: OrderRow[];
  counts: Record<OrderStatus, number>;
}

const RANK: Record<OrderStatus, number> = { pending: 0, held: 1, placed: 2, cancelled: 3 };

/**
 * Every buying decision with where it came from, what Raghav changed, and the age of the data it rests on.
 * Data age is the as-of date of the SAP data to the day the order was placed (or today, while it still waits):
 * the number this system exists to cut from 21 to 28 days (docs/09-MEASUREMENT-PLAN.md).
 */
export async function getOrders(db: AnyDb, opts: { status?: OrderStatus | "all"; now?: Date } = {}): Promise<OrdersResult> {
  const today = istDate(opts.now ?? new Date());
  const rows = await db
    .select({ b: buyingDecisions, r: reviews, d: aiDecisions, run: runs, s: skus, placer: users.name })
    .from(buyingDecisions)
    .innerJoin(reviews, eq(reviews.id, buyingDecisions.reviewId))
    .innerJoin(aiDecisions, eq(aiDecisions.id, reviews.aiDecisionId))
    .innerJoin(flags, eq(flags.id, aiDecisions.flagId))
    .innerJoin(runs, eq(runs.id, flags.runId))
    .innerJoin(skus, eq(skus.skuId, buyingDecisions.skuId))
    .leftJoin(users, eq(users.id, buyingDecisions.placedBy))
    .where(opts.status && opts.status !== "all" ? eq(buyingDecisions.status, opts.status) : undefined);

  const all: OrderRow[] = rows.map(({ b, r, d, run, s, placer }) => {
    const asOfDate = (run.summaryJson as { as_of_date: string }).as_of_date;
    const ageUntil = b.placedAt ? istDate(b.placedAt) : today;
    return {
      id: b.id,
      skuId: b.skuId,
      skuName: s.name,
      unit: s.uom,
      action: b.action,
      quantity: b.quantity,
      status: b.status,
      orderReference: b.sinkRef,
      source: r.outcome === "accepted" ? "ai_accepted" : "raghav_changed",
      reasonCode: r.reasonCode,
      reasonText: r.reasonText,
      runId: run.id,
      asOfDate,
      aiAction: d.action,
      aiQuantity: d.quantity,
      runDate: istDate(run.createdAt),
      dataAgeDays: daysBetween(asOfDate, ageUntil),
      placedAt: b.placedAt,
      placedBy: placer,
    };
  });

  all.sort((a, b) => RANK[a.status] - RANK[b.status] || b.runId - a.runId || (a.skuId < b.skuId ? -1 : a.skuId > b.skuId ? 1 : 0));
  const counts = Object.fromEntries(ORDER_STATUSES.map((s) => [s, 0])) as Record<OrderStatus, number>;
  for (const o of all) if (o.action !== "NO_ACTION") counts[o.status]++;
  return {
    orders: all.filter((o) => o.action !== "NO_ACTION"),
    noOrderNeeded: all.filter((o) => o.action === "NO_ACTION"),
    counts,
  };
}

export const MAX_PLACE = 500;
export const MAX_REFERENCE = 100;

/**
 * Procurement marks decisions as placed (or, for a "hold the next order" decision, as confirmed), with an optional
 * order reference. The system never places an order itself (guardrail G-B2). All or nothing.
 */
export async function markPlaced(
  db: AnyDb,
  actor: SessionUser,
  ids: unknown,
  orderReference: unknown,
): Promise<{ placed: number; ids: number[] }> {
  assertCan(actor.role, "mark_placed");
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PLACE || ids.some((i) => typeof i !== "number" || !Number.isInteger(i) || i <= 0)) {
    throw badRequest("BAD_IDS", `Send between 1 and ${MAX_PLACE} order ids, each a positive whole number.`);
  }
  const unique = [...new Set(ids as number[])];

  let reference: string | null = null;
  if (orderReference !== undefined && orderReference !== null && orderReference !== "") {
    if (typeof orderReference !== "string") throw badRequest("BAD_REFERENCE", "The order reference must be text.");
    reference = orderReference.trim() === "" ? null : orderReference.trim();
    if (reference !== null && (reference.length > MAX_REFERENCE || /[\u0000-\u001f]/.test(reference))) {
      throw badRequest("BAD_REFERENCE", `The order reference is at most ${MAX_REFERENCE} characters, on one line.`);
    }
  }

  return db.transaction(async (tx) => {
    const found = await tx
      .select({ id: buyingDecisions.id, skuId: buyingDecisions.skuId, action: buyingDecisions.action, status: buyingDecisions.status })
      .from(buyingDecisions)
      .where(inArray(buyingDecisions.id, unique));
    const missing = unique.filter((i) => !found.some((f) => f.id === i));
    if (missing.length) throw notFound(`Orders not found: ${missing.join(", ")}.`);

    const noAction = found.filter((f) => f.action === "NO_ACTION");
    if (noAction.length) throw badRequest("NOTHING_TO_PLACE", `No order is needed for: ${noAction.map((f) => f.skuId).join(", ")}.`);
    const held = found.filter((f) => f.status === "held");
    if (held.length) throw conflict("HELD", `${HELD_MESSAGE} (${held.map((f) => f.skuId).join(", ")})`);
    const notPending = found.filter((f) => f.status !== "pending");
    if (notPending.length) throw conflict("NOT_PENDING", `Already ${notPending[0].status}: ${notPending.map((f) => f.skuId).join(", ")}.`);

    const placedAt = new Date();
    const updated = await tx
      .update(buyingDecisions)
      .set({ status: "placed", placedBy: actor.id, placedAt, sinkRef: reference })
      .where(and(inArray(buyingDecisions.id, unique), eq(buyingDecisions.status, "pending")))
      .returning({ id: buyingDecisions.id, skuId: buyingDecisions.skuId, action: buyingDecisions.action, quantity: buyingDecisions.quantity });
    if (updated.length !== unique.length) {
      throw conflict("NOT_PENDING", "Some orders changed while you were working. Reload and try again.");
    }
    await writeAuditMany(
      tx,
      updated.map((u) => ({
        actorId: actor.id,
        action: "buying_decision.placed",
        entity: "buying_decision",
        entityId: u.id,
        before: { status: "pending" },
        after: { status: "placed", orderReference: reference, action: u.action, quantity: u.quantity },
      })),
    );
    return { placed: updated.length, ids: unique };
  });
}

/** The CSV for procurement. Pending orders by default. Every export is recorded (data is leaving the system). */
export async function exportOrders(
  db: AnyDb,
  actor: SessionUser,
  opts: { status?: string | null; now?: Date } = {},
): Promise<{ filename: string; content: string; count: number }> {
  assertCan(actor.role, "export_orders");
  const status = opts.status ?? "pending";
  if (status !== "all" && !(ORDER_STATUSES as string[]).includes(status)) {
    throw badRequest("BAD_STATUS", `status must be one of: ${ORDER_STATUSES.join(", ")}, all.`);
  }
  const now = opts.now ?? new Date();
  const { orders } = await getOrders(db, { status: status as OrderStatus | "all", now });
  const sink = new CsvSink();
  const result = await sink.createDraftOrders(orders);
  await writeAuditMany(db, [
    { actorId: actor.id, action: "orders.exported", entity: "orders", entityId: result.ref, after: { status, rows: orders.length, ids: orders.map((o) => o.id) } },
  ]);
  return { filename: `freshroots-orders-${istDate(now)}.csv`, content: result.content!, count: orders.length };
}
