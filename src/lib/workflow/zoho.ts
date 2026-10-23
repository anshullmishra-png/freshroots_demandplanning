import { and, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { buyingDecisions } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import { istDate } from "@/lib/dates/isoWeek";
import { AppError, badRequest, conflict, notFound } from "@/lib/errors";
import { HELD_MESSAGE } from "@/lib/orders-shared";
import { ZohoSink } from "@/lib/orders/zohoSink";
import { ZohoError, zohoAppUrl, zohoClientFromEnv, type ZohoClient } from "@/lib/zoho/client";
import { writeAuditMany } from "./audit";
import { MAX_PLACE, getOrders } from "./orders";

export interface SendToZohoResult {
  /** Orders that now have a draft purchase order in Zoho. */
  sent: number;
  /** Orders that already had one, left alone. */
  alreadyInZoho: number;
  /** Holds: an instruction, not an order, so nothing was made in Zoho. */
  holds: number;
  failed: Array<{ skuId: string; error: string }>;
  purchaseOrders: Array<{ number: string; id: string; lines: number; url: string }>;
}

export const notConnected = () => new AppError(409, "ZOHO_NOT_CONNECTED", "Zoho Inventory is not connected on this deployment.");

function clientOrThrow(client?: ZohoClient): ZohoClient {
  const c = client ?? zohoClientFromEnv();
  if (!c) throw notConnected();
  return c;
}

/**
 * Procurement sends reviewed orders to Zoho Inventory. One DRAFT purchase order is made per distributor; procurement
 * checks the price and issues it in Zoho. Nothing is issued, approved or cancelled from here (guardrail G-B3), and a
 * second send of the same orders finds the first and makes no duplicate.
 */
export async function sendToZoho(
  db: AnyDb,
  actor: SessionUser,
  ids: unknown,
  opts: { client?: ZohoClient; now?: Date } = {},
): Promise<SendToZohoResult> {
  assertCan(actor.role, "mark_placed");
  if (!Array.isArray(ids) || ids.length === 0 || ids.length > MAX_PLACE || ids.some((i) => typeof i !== "number" || !Number.isInteger(i) || i <= 0)) {
    throw badRequest("BAD_IDS", `Send between 1 and ${MAX_PLACE} order ids, each a positive whole number.`);
  }
  const unique = [...new Set(ids as number[])];
  const client = clientOrThrow(opts.client);

  const { orders, noOrderNeeded } = await getOrders(db, { status: "all", now: opts.now });
  const byId = new Map([...orders, ...noOrderNeeded].map((o) => [o.id, o]));
  const missing = unique.filter((i) => !byId.has(i));
  if (missing.length) throw notFound(`Orders not found: ${missing.join(", ")}.`);
  const chosen = unique.map((i) => byId.get(i)!);
  const held = chosen.filter((o) => o.status === "held");
  if (held.length) throw conflict("HELD", `${HELD_MESSAGE} (${held.map((o) => o.skuId).join(", ")})`);
  const notPending = chosen.filter((o) => o.status !== "pending");
  if (notPending.length) throw conflict("NOT_PENDING", `Already ${notPending[0].status}: ${notPending.map((o) => o.skuId).join(", ")}.`);

  const already = chosen.filter((o) => o.zohoPoId);
  const todo = chosen.filter((o) => !o.zohoPoId);
  const sink = new ZohoSink(client, istDate(opts.now ?? new Date()));
  let sunk: Awaited<ReturnType<ZohoSink["createDraftOrders"]>>;
  try {
    sunk = todo.length ? await sink.createDraftOrders(todo) : { ref: "zoho:none", results: [] };
  } catch (e) {
    // Zoho itself said no (a refused connection, a rate limit): say so in its words, with a proper status.
    if (e instanceof ZohoError) throw new AppError(e.status === 429 ? 429 : 502, e.code, e.message);
    throw e;
  }

  const good = sunk.results.filter((r) => r.ok && r.decisionId && r.purchaseOrderId);
  const failed = sunk.results.filter((r) => !r.ok && !r.error?.startsWith("Not an order")).map((r) => ({ skuId: r.sku_id, error: r.error ?? "Failed." }));
  const holds = sunk.results.filter((r) => !r.ok && r.error?.startsWith("Not an order")).length;

  const sentAt = opts.now ?? new Date();
  const poById = new Map<string, { number: string; id: string; lines: number }>();
  for (const r of good) {
    const po = poById.get(r.purchaseOrderId!) ?? { number: r.purchaseOrderNumber!, id: r.purchaseOrderId!, lines: 0 };
    po.lines++;
    poById.set(po.id, po);
  }
  if (good.length) {
    await db.transaction(async (tx) => {
      for (const po of poById.values()) {
        const rows = good.filter((r) => r.purchaseOrderId === po.id).map((r) => r.decisionId!);
        const updated = await tx
          .update(buyingDecisions)
          .set({ zohoPoId: po.id, zohoPoNumber: po.number, zohoSentAt: sentAt, zohoSentBy: actor.id })
          .where(and(inArray(buyingDecisions.id, rows), eq(buyingDecisions.status, "pending"), isNull(buyingDecisions.zohoPoId)))
          .returning({ id: buyingDecisions.id, skuId: buyingDecisions.skuId, quantity: buyingDecisions.quantity });
        await writeAuditMany(
          tx,
          updated.map((u) => ({
            actorId: actor.id,
            action: "buying_decision.sent_to_zoho",
            entity: "buying_decision",
            entityId: u.id,
            before: { zohoPoNumber: null },
            after: { zohoPoNumber: po.number, zohoPoId: po.id, quantity: u.quantity },
          })),
        );
      }
    });
  }

  return {
    sent: good.length,
    alreadyInZoho: already.length,
    holds,
    failed,
    purchaseOrders: [...poById.values()].map((p) => ({ ...p, url: zohoAppUrl(client.config, p.id) })),
  };
}

export interface SyncResult {
  /** Orders procurement has issued in Zoho: now marked placed here, with the Zoho number as the reference. */
  placed: number;
  stillDraft: number;
  /** Orders whose Zoho draft was cancelled or deleted: back to unsent so they can be sent again. */
  reset: number;
  errors: string[];
}

const LIVE_STATUSES = new Set(["draft"]);
const GONE_STATUSES = new Set(["cancelled", "void", "deleted", "rejected"]);

/**
 * Asks Zoho what became of the drafts. A draft that procurement issued means the order is placed; a cancelled or
 * deleted one goes back to "not sent". Only reads from Zoho. Safe to run as often as wanted.
 */
export async function syncFromZoho(db: AnyDb, actor: SessionUser, opts: { client?: ZohoClient; now?: Date } = {}): Promise<SyncResult> {
  assertCan(actor.role, "mark_placed");
  const client = clientOrThrow(opts.client);
  const rows = await db
    .select({ id: buyingDecisions.id, poId: buyingDecisions.zohoPoId, poNumber: buyingDecisions.zohoPoNumber, action: buyingDecisions.action, quantity: buyingDecisions.quantity })
    .from(buyingDecisions)
    .where(and(eq(buyingDecisions.status, "pending"), isNotNull(buyingDecisions.zohoPoId)));

  const byPo = new Map<string, typeof rows>();
  for (const r of rows) byPo.set(r.poId!, [...(byPo.get(r.poId!) ?? []), r]);

  const out: SyncResult = { placed: 0, stillDraft: 0, reset: 0, errors: [] };
  const placedAt = opts.now ?? new Date();
  for (const [poId, group] of byPo) {
    try {
      const po = await client.getPurchaseOrder(poId);
      const ids = group.map((g) => g.id);
      if (po && LIVE_STATUSES.has(po.status)) {
        out.stillDraft += group.length;
      } else if (!po || GONE_STATUSES.has(po.status)) {
        await db.transaction(async (tx) => {
          await tx
            .update(buyingDecisions)
            .set({ zohoPoId: null, zohoPoNumber: null, zohoSentAt: null, zohoSentBy: null })
            .where(and(inArray(buyingDecisions.id, ids), eq(buyingDecisions.status, "pending")));
          await writeAuditMany(
            tx,
            group.map((g) => ({
              actorId: actor.id,
              action: "buying_decision.zoho_draft_removed",
              entity: "buying_decision",
              entityId: g.id,
              before: { zohoPoNumber: g.poNumber },
              after: { zohoPoNumber: null, zohoStatus: po?.status ?? "deleted" },
            })),
          );
        });
        out.reset += group.length;
      } else {
        await db.transaction(async (tx) => {
          const updated = await tx
            .update(buyingDecisions)
            .set({ status: "placed", placedBy: actor.id, placedAt, sinkRef: po.number })
            .where(and(inArray(buyingDecisions.id, ids), eq(buyingDecisions.status, "pending")))
            .returning({ id: buyingDecisions.id, action: buyingDecisions.action, quantity: buyingDecisions.quantity });
          await writeAuditMany(
            tx,
            updated.map((u) => ({
              actorId: actor.id,
              action: "buying_decision.placed",
              entity: "buying_decision",
              entityId: u.id,
              before: { status: "pending" },
              after: { status: "placed", orderReference: po.number, action: u.action, quantity: u.quantity, source: "zoho", zohoStatus: po.status },
            })),
          );
          out.placed += updated.length;
        });
      }
    } catch (e) {
      out.errors.push(`${group[0].poNumber ?? poId}: ${e instanceof ZohoError ? e.message : "Zoho could not be reached."}`);
    }
  }
  return out;
}
