import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDecisions, auditLog, buyingDecisions, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { HELD_MESSAGE, describeOrder } from "@/lib/orders-shared";
import { bulkAccept, reviewDecision, type ReviewRequest } from "@/lib/workflow/review";
import { exportOrders, getOrders, markPlaced } from "@/lib/workflow/orders";
import { parseCsv } from "@/lib/validation/csv";
import { count, cookieFor, createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, startSeedRun, tokenFor, type TestUsers } from "../helpers/workflow";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));

import { GET as exportRoute } from "@/app/api/orders/export/route";
import { POST as placeRoute } from "@/app/api/orders/place/route";

let db: AnyDb;
let u: TestUsers;
let runId: number;

const DAY1 = new Date("2026-10-20T10:00:00+05:30");
const DAY3 = new Date("2026-10-22T10:00:00+05:30");
const DAY11 = new Date("2026-10-30T10:00:00+05:30");

beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
});
beforeEach(async () => {
  await resetRunData(db);
  runId = (await newSeedRun(db, { createdBy: u.raghav.id })).runId;
});
afterEach(() => vi.useRealTimers());

const reject = (aiDecisionId: number, change: Record<string, unknown>) =>
  ({ aiDecisionId, outcome: "rejected", change }) as unknown as ReviewRequest;

/** Reviews the whole run: SKU001 changed to 600 (with a hostile reason), SKU013 changed to no action, the rest accepted. */
async function reviewEverything() {
  await reviewDecision(db, u.raghav, reject(await idFor(db, runId, "SKU001"), {
    flagTypes: ["STOCKOUT_RISK"], action: "REORDER", quantity: 600, reasonCode: "OTHER", reasonText: "=HYPERLINK(\"http://evil.example\",\"x\")",
  }));
  await reviewDecision(db, u.raghav, reject(await idFor(db, runId, "SKU013"), { flagTypes: [], action: "NO_ACTION", quantity: 0, reasonCode: "MARKET_EVENT" }));
  const rest = ["SKU003", "SKU004", "SKU006", "SKU007", "SKU011"];
  await bulkAccept(db, u.raghav, await Promise.all(rest.map((s) => idFor(db, runId, s))));
}

async function orderIdFor(sku: string): Promise<number> {
  const [row] = await db.select({ id: buyingDecisions.id }).from(buyingDecisions).where(eq(buyingDecisions.skuId, sku));
  return row.id;
}

describe("nothing reaches buying without a review (G-B1)", () => {
  it("before any review there are no orders at all", async () => {
    const r = await getOrders(db);
    expect(r.orders).toEqual([]);
    expect(r.noOrderNeeded).toEqual([]);
    expect(r.counts).toEqual({ pending: 0, placed: 0, held: 0, cancelled: 0 });
  });

  it("a decision appears as an order only after it has been reviewed", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU003"), outcome: "accepted" });
    const r = await getOrders(db);
    expect(r.orders.map((o) => o.skuId)).toEqual(["SKU003"]);
  });
});

describe("the orders list", () => {
  it("shows where each came from, what Raghav changed and why, and the age of the data", async () => {
    await reviewEverything();
    const r = await getOrders(db, { now: DAY3 });
    expect(r.orders).toHaveLength(6); // SKU013 is "no action": nothing to order
    expect(r.noOrderNeeded.map((o) => o.skuId)).toEqual(["SKU013"]);
    expect(r.counts).toEqual({ pending: 6, placed: 0, held: 0, cancelled: 0 });

    const changed = r.orders.find((o) => o.skuId === "SKU001")!;
    expect(changed).toMatchObject({
      source: "raghav_changed", action: "REORDER", quantity: 600, aiAction: "REORDER", aiQuantity: 750,
      reasonCode: "OTHER", status: "pending", unit: "Units", skuName: "Freshroots Mango Drink 200ml", runId, asOfDate: "2026-10-19",
    });
    expect(changed.reasonText).toContain("HYPERLINK");
    const accepted = r.orders.find((o) => o.skuId === "SKU003")!;
    expect(accepted).toMatchObject({ source: "ai_accepted", quantity: 300, reasonCode: null, orderReference: null, placedAt: null, placedBy: null });
    expect(r.orders.every((o) => o.dataAgeDays === 3)).toBe(true); // 19 October to 22 October
  });

  it("data age grows while an order waits, and stops when procurement places it", async () => {
    await reviewEverything();
    const id = await orderIdFor("SKU003");
    expect((await getOrders(db, { now: DAY1 })).orders.find((o) => o.id === id)!.dataAgeDays).toBe(1);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAY3);
    await markPlaced(db, u.procurement, [id], "PO-17");
    vi.useRealTimers();
    // Ten days later the waiting orders are 11 days old, but the placed one stays at the age it was placed.
    const later = await getOrders(db, { now: DAY11 });
    expect(later.orders.find((o) => o.id === id)).toMatchObject({ dataAgeDays: 3, status: "placed" });
    expect(later.orders.find((o) => o.skuId === "SKU004")!.dataAgeDays).toBe(11);
  });

  it("lists pending first, then held, then placed, newest run first, then by SKU", async () => {
    await reviewEverything();
    const second = (await startSeedRun(db, u.raghav, { acknowledgeWarnings: true })).runId;
    await bulkAccept(db, u.raghav, [await idFor(db, second, "SKU003")]);
    await db.update(buyingDecisions).set({ status: "held" }).where(eq(buyingDecisions.skuId, "SKU011"));
    await markPlaced(db, u.procurement, [await orderIdFor("SKU004")], null);
    const r = await getOrders(db, { now: DAY3 });
    expect(r.orders.map((o) => `${o.status}:${o.runId}:${o.skuId}`)).toEqual([
      `pending:${second}:SKU003`,
      `pending:${runId}:SKU001`,
      `pending:${runId}:SKU003`,
      `pending:${runId}:SKU006`,
      `pending:${runId}:SKU007`,
      `held:${runId}:SKU011`,
      `placed:${runId}:SKU004`,
    ]);
  });

  it("can be filtered by status", async () => {
    await reviewEverything();
    await markPlaced(db, u.procurement, [await orderIdFor("SKU003")], null);
    expect((await getOrders(db, { status: "placed" })).orders.map((o) => o.skuId)).toEqual(["SKU003"]);
    expect((await getOrders(db, { status: "pending" })).orders).toHaveLength(5);
    expect((await getOrders(db, { status: "all" })).orders).toHaveLength(6);
  });

  it("describes a pause as holding the next order, never as a cancellation (G-B4)", () => {
    expect(describeOrder("PAUSE_ORDER", 0)).toBe("Hold the next order");
    expect(describeOrder("REORDER", 750, "Units")).toBe("Reorder 750 Units");
    expect(describeOrder("NO_ACTION", 0)).toBe("No order needed");
    expect(describeOrder("PAUSE_ORDER", 0)).not.toMatch(/cancel/i);
  });
});

describe("mark placed (G-B2)", () => {
  it("procurement places orders: status, who, when and the reference are recorded and audited", async () => {
    await reviewEverything();
    const ids = [await orderIdFor("SKU003"), await orderIdFor("SKU004")];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(DAY3);
    const res = await markPlaced(db, u.procurement, ids, "  PO-2026-1017  ");
    vi.useRealTimers();
    expect(res).toEqual({ placed: 2, ids });
    const rows = await db.select().from(buyingDecisions).where(eq(buyingDecisions.status, "placed"));
    expect(rows).toHaveLength(2);
    for (const r of rows) {
      expect(r).toMatchObject({ placedBy: u.procurement.id, sinkRef: "PO-2026-1017", sink: "csv" });
      expect(r.placedAt?.toISOString()).toBe(DAY3.toISOString());
    }
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.placed"));
    expect(log).toHaveLength(2);
    expect(log[0]).toMatchObject({ actorId: u.procurement.id, entity: "buying_decision" });
    expect(log[0].afterJson).toMatchObject({ status: "placed", orderReference: "PO-2026-1017" });
    const shown = (await getOrders(db, { now: DAY3 })).orders.find((o) => o.id === ids[0])!;
    expect(shown).toMatchObject({ status: "placed", orderReference: "PO-2026-1017", placedBy: "Test procurement" });
  });

  it("the order reference is optional", async () => {
    await reviewEverything();
    for (const ref of [undefined, null, "", "   "]) {
      const id = await orderIdFor(["SKU003", "SKU004", "SKU006", "SKU007"][[undefined, null, "", "   "].indexOf(ref)]);
      await markPlaced(db, u.procurement, [id], ref);
      expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, id)))[0].sinkRef).toBeNull();
    }
  });

  it("a 'hold the next order' decision can be confirmed too", async () => {
    await reviewEverything();
    const id = await orderIdFor("SKU006"); // PAUSE_ORDER
    await expect(markPlaced(db, u.procurement, [id], null)).resolves.toMatchObject({ placed: 1 });
  });

  it("refuses a decision that is already placed, and changes nothing else in the batch", async () => {
    await reviewEverything();
    const a = await orderIdFor("SKU003");
    const b = await orderIdFor("SKU004");
    await markPlaced(db, u.procurement, [a], null);
    await expect(markPlaced(db, u.procurement, [a, b], null)).rejects.toMatchObject({ status: 409, code: "NOT_PENDING" });
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, b)))[0].status).toBe("pending");
  });

  it("refuses held orders with the stop message: confirm with Raghav first", async () => {
    await reviewEverything();
    const id = await orderIdFor("SKU003");
    await db.update(buyingDecisions).set({ status: "held" }).where(eq(buyingDecisions.id, id));
    await expect(markPlaced(db, u.procurement, [id], null)).rejects.toMatchObject({ status: 409, code: "HELD", message: expect.stringContaining(HELD_MESSAGE) });
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, id)))[0].status).toBe("held");
  });

  it("refuses a 'no action' decision: there is nothing to place", async () => {
    await reviewEverything();
    await expect(markPlaced(db, u.procurement, [await orderIdFor("SKU013")], null)).rejects.toMatchObject({ code: "NOTHING_TO_PLACE" });
  });

  it("refuses a cancelled order, an unknown id, and bad input", async () => {
    await reviewEverything();
    const id = await orderIdFor("SKU003");
    await db.update(buyingDecisions).set({ status: "cancelled" }).where(eq(buyingDecisions.id, id));
    await expect(markPlaced(db, u.procurement, [id], null)).rejects.toMatchObject({ code: "NOT_PENDING" });
    await expect(markPlaced(db, u.procurement, [99999], null)).rejects.toMatchObject({ status: 404 });
    for (const bad of [[], "x", [0], [-1], [1.5], ["1"], new Array(501).fill(1)]) {
      await expect(markPlaced(db, u.procurement, bad, null)).rejects.toMatchObject({ code: "BAD_IDS" });
    }
    const ok = await orderIdFor("SKU004");
    await expect(markPlaced(db, u.procurement, [ok], "x".repeat(101))).rejects.toMatchObject({ code: "BAD_REFERENCE" });
    await expect(markPlaced(db, u.procurement, [ok], "line1\nline2")).rejects.toMatchObject({ code: "BAD_REFERENCE" });
    await expect(markPlaced(db, u.procurement, [ok], 42)).rejects.toMatchObject({ code: "BAD_REFERENCE" });
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, ok)))[0].status).toBe("pending");
  });

  it("two people placing the same order at once: exactly one succeeds", async () => {
    await reviewEverything();
    const id = await orderIdFor("SKU003");
    const results = await Promise.allSettled([markPlaced(db, u.procurement, [id], "A"), markPlaced(db, u.procurement, [id], "B")]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.placed"))).toHaveLength(1);
  });

  it.each(ROLES.filter((r) => r !== "procurement"))("%s cannot mark orders placed (403)", async (role) => {
    await reviewEverything();
    const id = await orderIdFor("SKU003");
    await expect(markPlaced(db, u[role], [id], null)).rejects.toMatchObject({ status: 403 });
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, id)))[0].status).toBe("pending");
  });
});

describe("CSV export", () => {
  it("exports the pending orders for procurement, one row each, with the instruction in plain words", async () => {
    await reviewEverything();
    const out = await exportOrders(db, u.procurement, { now: DAY3 });
    expect(out.filename).toBe("freshroots-orders-2026-10-22.csv");
    expect(out.count).toBe(6);
    expect(out.content.startsWith("﻿")).toBe(true);
    const rows = parseCsv(out.content).map((r) => r.cells);
    expect(rows).toHaveLength(7);
    const bySku = Object.fromEntries(rows.slice(1).map((r) => [r[1], r]));
    expect(Object.keys(bySku).sort()).toEqual(["SKU001", "SKU003", "SKU004", "SKU006", "SKU007", "SKU011"]);
    expect(bySku.SKU001[4]).toBe("Reorder 600 Units");
    expect(bySku.SKU001[7]).toBe("Raghav changed");
    expect(bySku.SKU006[4]).toBe("Hold the next order");
    expect(bySku.SKU003[7]).toBe("AI accepted");
    expect(rows.slice(1).every((r) => r[12] === "pending")).toBe(true);
  });

  it("turns a hostile reason from the review into plain text (G-S7)", async () => {
    await reviewEverything();
    const rows = parseCsv((await exportOrders(db, u.procurement)).content).map((r) => r.cells);
    const sku001 = rows.find((r) => r[1] === "SKU001")!;
    expect(sku001[9].startsWith("'=HYPERLINK(")).toBe(true);
    for (const row of rows) for (const cell of row) expect(cell).not.toMatch(/^[=+\-@\t\r]/);
  });

  it("includes order references, escaped, when placed orders are exported", async () => {
    await reviewEverything();
    await markPlaced(db, u.procurement, [await orderIdFor("SKU003")], "+91 98765 43210");
    const rows = parseCsv((await exportOrders(db, u.procurement, { status: "placed" })).content).map((r) => r.cells);
    expect(rows).toHaveLength(2);
    expect(rows[1][13]).toBe("'+91 98765 43210");
    expect(rows[1][12]).toBe("placed");
  });

  it("filters by status and refuses an unknown one", async () => {
    await reviewEverything();
    await markPlaced(db, u.procurement, [await orderIdFor("SKU003")], null);
    expect((await exportOrders(db, u.procurement, { status: "all" })).count).toBe(6);
    expect((await exportOrders(db, u.procurement, { status: "held" })).count).toBe(0);
    expect((await exportOrders(db, u.procurement)).count).toBe(5);
    await expect(exportOrders(db, u.procurement, { status: "everything" })).rejects.toMatchObject({ code: "BAD_STATUS" });
  });

  it("never includes 'no order needed' rows", async () => {
    await reviewEverything();
    const text = (await exportOrders(db, u.procurement, { status: "all" })).content;
    expect(text).not.toContain("SKU013");
    expect(text).not.toContain("NO_ACTION");
  });

  it("records every export in the audit log", async () => {
    await reviewEverything();
    await exportOrders(db, u.procurement, { now: DAY3 });
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "orders.exported"));
    expect(entry.actorId).toBe(u.procurement.id);
    expect(entry.afterJson).toMatchObject({ status: "pending", rows: 6 });
  });

  it.each(ROLES.filter((r) => r !== "procurement"))("%s cannot export (403)", async (role) => {
    await reviewEverything();
    await expect(exportOrders(db, u[role])).rejects.toMatchObject({ status: 403 });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "orders.exported"))).toHaveLength(0);
  });
});

describe("order routes", () => {
  async function call(handler: (req: Request) => Promise<Response>, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; url?: string } = {}) {
    const headers: Record<string, string> = { host: "localhost", ...(opts.headers ?? {}) };
    if (opts.token) headers.cookie = cookieFor(opts.token);
    let body: string | undefined;
    if (opts.body !== undefined) {
      headers["content-type"] = "application/json";
      body = JSON.stringify(opts.body);
    }
    const res = await handler(new Request(opts.url ?? "http://localhost/api/orders/x", { method: opts.method ?? "POST", headers, body }));
    return res;
  }

  it("place and export need sign-in (401)", async () => {
    expect((await call(placeRoute, { body: { ids: [1] } })).status).toBe(401);
    expect((await call(exportRoute, { method: "GET" })).status).toBe(401);
  });

  it.each(ROLES.filter((r) => r !== "procurement"))("%s gets 403 on place and on export", async (role) => {
    const token = await tokenFor(u[role]);
    expect((await call(placeRoute, { token, body: { ids: [1] } })).status).toBe(403);
    expect((await call(exportRoute, { token, method: "GET" })).status).toBe(403);
  });

  it("procurement places orders over HTTP", async () => {
    await reviewEverything();
    const token = await tokenFor(u.procurement);
    const id = await orderIdFor("SKU003");
    const res = await call(placeRoute, { token, body: { ids: [id], orderReference: "PO-9" } });
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({ placed: 1, ids: [id] });
    const again = await call(placeRoute, { token, body: { ids: [id] } });
    expect(again.status).toBe(409);
  });

  it("a placement from another site is refused", async () => {
    await reviewEverything();
    const token = await tokenFor(u.procurement);
    const res = await call(placeRoute, { token, headers: { origin: "https://evil.example" }, body: { ids: [await orderIdFor("SKU003")] } });
    expect(res.status).toBe(403);
    expect(await count(db, "buying_decisions")).toBe(7);
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.status, "placed")))).toHaveLength(0);
  });

  it("export sends a CSV download that is never cached or sniffed", async () => {
    await reviewEverything();
    const token = await tokenFor(u.procurement);
    const res = await call(exportRoute, { token, method: "GET", url: "http://localhost/api/orders/export?status=pending" });
    expect(res.status).toBe(200);
    expect(res.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(res.headers.get("content-disposition")).toMatch(/^attachment; filename="freshroots-orders-\d{4}-\d{2}-\d{2}\.csv"$/);
    expect(res.headers.get("cache-control")).toBe("no-store");
    expect(res.headers.get("x-content-type-options")).toBe("nosniff");
    expect(parseCsv(await res.text())).toHaveLength(7);
    const bad = await call(exportRoute, { token, method: "GET", url: "http://localhost/api/orders/export?status=nope" });
    expect(bad.status).toBe(400);
  });
});

describe("the whole procurement flow, end to end", () => {
  it("run, review, then procurement sees the orders, places them and exports the record", async () => {
    await resetRunData(db);
    const run = await startSeedRun(db, u.raghav, { acknowledgeWarnings: true });
    expect((await getOrders(db)).orders).toHaveLength(0); // flagged and decided, but not yet reviewed
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    await bulkAccept(db, u.raghav, ids);
    const waiting = await getOrders(db, { now: DAY3 });
    expect(waiting.counts).toEqual({ pending: 7, placed: 0, held: 0, cancelled: 0 });
    expect(waiting.orders.every((o) => o.runId === run.runId && o.source === "ai_accepted")).toBe(true);

    await markPlaced(db, u.procurement, waiting.orders.map((o) => o.id), "BATCH-1");
    const done = await getOrders(db);
    expect(done.counts).toEqual({ pending: 0, placed: 7, held: 0, cancelled: 0 });
    expect(done.orders.every((o) => o.orderReference === "BATCH-1" && o.placedBy === "Test procurement")).toBe(true);
    const csv = await exportOrders(db, u.procurement, { status: "placed" });
    expect(csv.count).toBe(7);
    const actions = (await db.select().from(auditLog)).map((a) => a.action);
    for (const expected of ["snapshot.uploaded", "run.created", "run.ai_done", "review.accepted", "buying_decision.placed", "orders.exported"]) {
      expect(actions).toContain(expected);
    }
  });
});

it("the buying decisions table keeps its review link: an order cannot exist without one", async () => {
  await expect(db.insert(buyingDecisions).values({ reviewId: 12345, skuId: "SKU001", action: "REORDER", quantity: 1 })).rejects.toThrow();
  expect(await db.select().from(users).where(eq(users.role, "procurement"))).toHaveLength(1);
});
