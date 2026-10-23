import { eq, sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { auditLog, buyingDecisions } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { createLossEntry } from "@/lib/workflow/losses";
import { purchaseOrderReference } from "@/lib/orders/zohoSink";
import { createZohoClient, forgetZohoTokens } from "@/lib/zoho/client";
import { bulkAccept } from "@/lib/workflow/review";
import { markPlaced } from "@/lib/workflow/orders";
import { sendToZoho, syncFromZoho } from "@/lib/workflow/zoho";
import { seedFiles } from "../helpers/seed";
import { createFakeZoho, fakeConfig } from "../helpers/fakeZoho";
import { count, createTestDb, newSeedRun, resetRunData, seedTestUsers, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;
beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(async () => {
  forgetZohoTokens();
  await resetRunData(db);
});

const csv = (t: string) => t.split(/\r?\n/).slice(1).filter(Boolean).map((l) => l.split(","));
const files = seedFiles();
const SKUS = csv(files.sku_master).map((c) => ({ sku: c[0], name: c[1] }));
const VENDORS = csv(files.distributor_master).map((c) => c[1]);

const zohoWith = (over: Parameters<typeof createFakeZoho>[0] = {}) => {
  const zoho = createFakeZoho({ vendors: VENDORS, items: SKUS, ...over });
  return { zoho, client: createZohoClient(fakeConfig(), { fetch: zoho.fetch }) };
};

/** A run whose 7 decisions Raghav has accepted: 5 orders and 2 holds waiting for procurement. */
async function reviewedRun() {
  const run = await newSeedRun(db, { createdBy: u.raghav.id });
  const { rows } = (await db.execute(sql`SELECT id FROM ai_decisions ORDER BY id`)) as unknown as { rows: Array<{ id: number }> };
  await bulkAccept(db, u.raghav, rows.map((r) => r.id));
  const all = await db.select().from(buyingDecisions);
  return { run, reorders: all.filter((b) => b.action === "REORDER"), holds: all.filter((b) => b.action === "PAUSE_ORDER"), all };
}

describe("sending reviewed orders to Zoho", () => {
  it("makes one draft purchase order per distributor, remembers it on every order, and leaves them pending", async () => {
    const { reorders, holds } = await reviewedRun();
    expect(reorders.length).toBeGreaterThan(0);
    const { zoho, client } = zohoWith();
    const r = await sendToZoho(db, u.procurement, [...reorders, ...holds].map((b) => b.id), { client });
    expect(r.sent).toBe(reorders.length);
    expect(r.holds).toBe(holds.length);
    expect(r.failed).toEqual([]);
    const distributors = new Set((await db.execute(sql`SELECT d.name FROM buying_decisions b JOIN skus s ON s.sku_id = b.sku_id JOIN distributors d ON d.distributor_id = s.distributor_id WHERE b.action = 'REORDER'`) as unknown as { rows: Array<{ name: string }> }).rows.map((x) => x.name));
    expect(r.purchaseOrders).toHaveLength(distributors.size);
    expect(zoho.pos.size).toBe(distributors.size);
    expect(r.purchaseOrders.reduce((a, p) => a + p.lines, 0)).toBe(reorders.length);

    const after = await db.select().from(buyingDecisions);
    for (const b of after.filter((x) => x.action === "REORDER")) {
      expect(b).toMatchObject({ status: "pending", zohoSentBy: u.procurement.id });
      expect(b.zohoPoId).toBeTruthy();
      expect(b.zohoPoNumber).toMatch(/^PO-\d{5}$/);
      expect(b.zohoSentAt).toBeInstanceOf(Date);
    }
    for (const b of after.filter((x) => x.action === "PAUSE_ORDER")) expect(b.zohoPoId).toBeNull();
    expect(r.purchaseOrders.every((p) => p.url.startsWith("https://inventory.zoho.in/app/9001#/purchaseorders/"))).toBe(true);
  });

  it("every order goes to Zoho as a DRAFT with only vendor, reference, date, notes and quantities", async () => {
    const { reorders } = await reviewedRun();
    const { zoho, client } = zohoWith();
    await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    for (const po of zoho.pos.values()) {
      expect(po.status).toBe("draft");
      expect(Object.keys(po.body).sort()).toEqual(["date", "line_items", "notes", "reference_number", "vendor_id"]);
      expect(po.notes).toMatch(/Every line was reviewed by Raghav/);
      for (const line of po.line_items) expect(Object.keys(line).sort()).toEqual(["item_id", "quantity"]);
    }
    // The quantities are exactly the reviewed ones.
    const sentQty = [...zoho.pos.values()].flatMap((p) => p.line_items.map((l) => l.quantity)).sort((a, b) => a - b);
    expect(sentQty).toEqual(reorders.map((b) => b.quantity).sort((a, b) => a - b));
  });

  it("each send is written to the audit log with the Zoho number", async () => {
    const { reorders } = await reviewedRun();
    const { client } = zohoWith();
    await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    const rows = await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.sent_to_zoho"));
    expect(rows).toHaveLength(reorders.length);
    expect(rows[0]).toMatchObject({ actorId: u.procurement.id, entity: "buying_decision" });
    expect((rows[0].afterJson as { zohoPoNumber: string }).zohoPoNumber).toMatch(/^PO-/);
  });

  it("sending again makes no duplicate: orders that already have a draft are left alone", async () => {
    const { reorders } = await reviewedRun();
    const { zoho, client } = zohoWith();
    const ids = reorders.map((b) => b.id);
    await sendToZoho(db, u.procurement, ids, { client });
    const made = zoho.pos.size;
    const again = await sendToZoho(db, u.procurement, ids, { client });
    expect(again).toMatchObject({ sent: 0, alreadyInZoho: reorders.length, purchaseOrders: [] });
    expect(zoho.pos.size).toBe(made);
  });

  it("a retry after a crash finds the order Zoho already has, instead of making a second", async () => {
    const { reorders } = await reviewedRun();
    const { zoho, client } = zohoWith();
    const ids = reorders.map((b) => b.id);
    await sendToZoho(db, u.procurement, ids, { client });
    const made = zoho.pos.size;
    // The database forgot (the crash happened between Zoho answering and us saving).
    await db.update(buyingDecisions).set({ zohoPoId: null, zohoPoNumber: null, zohoSentAt: null, zohoSentBy: null });
    const retry = await sendToZoho(db, u.procurement, ids, { client });
    expect(zoho.pos.size).toBe(made);
    expect(retry.sent).toBe(reorders.length);
    expect(retry.purchaseOrders.every((p) => /^PO-\d{5}$/.test(p.number))).toBe(true);
  });

  it("the reference is stable for the same orders, in any order, and different when anything about them differs", () => {
    const a = { id: 1, skuId: "SKU001", quantity: 750 };
    const b = { id: 2, skuId: "SKU003", quantity: 300 };
    expect(purchaseOrderReference([b, a])).toBe(purchaseOrderReference([a, b]));
    expect(purchaseOrderReference([a, b])).not.toBe(purchaseOrderReference([a, { ...b, id: 3 }]));
    expect(purchaseOrderReference([a])).toMatch(/^FR-[0-9A-F]{12}$/);
    // After a reset the ids start again: the same id with another quantity or SKU is a different order.
    expect(purchaseOrderReference([a])).not.toBe(purchaseOrderReference([{ ...a, quantity: 800 }]));
    expect(purchaseOrderReference([a])).not.toBe(purchaseOrderReference([{ ...a, skuId: "SKU002" }]));
  });

  it("a SKU or vendor that is not in Zoho fails on its own; the rest still go", async () => {
    const { reorders } = await reviewedRun();
    const skuMissing = reorders[0];
    const { zoho, client } = zohoWith({ items: SKUS.filter((s) => s.sku !== skuMissing.skuId) });
    const r = await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    expect(r.failed).toEqual([{ skuId: skuMissing.skuId, error: `Item ${skuMissing.skuId} is not in Zoho.` }]);
    expect(r.sent).toBe(reorders.length - 1);
    const left = await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, skuMissing.id));
    expect(left[0].zohoPoId).toBeNull();
    expect(zoho.pos.size).toBeGreaterThan(0);

    // Start again with nothing sent, against a Zoho that has no vendors.
    await db.update(buyingDecisions).set({ zohoPoId: null, zohoPoNumber: null, zohoSentAt: null, zohoSentBy: null });
    forgetZohoTokens(); // a different Zoho, so a different token
    const noVendors = zohoWith({ vendors: [] });
    const r2 = await sendToZoho(db, u.procurement, reorders.map((b) => b.id).filter((id) => id !== skuMissing.id), { client: noVendors.client });
    expect(r2.sent).toBe(0);
    expect(r2.failed.length).toBeGreaterThan(0);
    expect(r2.failed[0].error).toMatch(/Vendor ".+" is not in Zoho/);
  });

  it("when Zoho refuses the connection nothing is saved and the message is safe", async () => {
    const { reorders } = await reviewedRun();
    const zoho = createFakeZoho({ vendors: VENDORS, items: SKUS });
    const client = createZohoClient(fakeConfig({ clientSecret: "wrong" }), { fetch: zoho.fetch });
    const err = await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client }).catch((e) => e);
    expect(err).toMatchObject({ status: 502, code: "ZOHO_AUTH" });
    expect(err.message).not.toContain("wrong");
    expect((await db.select().from(buyingDecisions)).every((b) => b.zohoPoId === null)).toBe(true);
  });

  it("understands Zoho answering with the order under 'purchaseorder' as well as 'purchase_order'", async () => {
    const { reorders } = await reviewedRun();
    const { zoho, client } = zohoWith({ poKey: "purchaseorder" });
    const r = await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    expect(r.sent).toBe(reorders.length);
    expect(r.failed).toEqual([]);
    zoho.issue(r.purchaseOrders[0].id);
    expect((await syncFromZoho(db, u.procurement, { client })).placed).toBe(r.purchaseOrders[0].lines);
  });

  it("never drops an order silently: if Zoho does not say which order it made, every line is reported", async () => {
    const { reorders } = await reviewedRun();
    const { client } = zohoWith({ poKey: "none" });
    const r = await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    expect(r.sent).toBe(0);
    expect(r.failed.length).toBe(reorders.length);
    expect(r.failed[0].error).toMatch(/did not say which order it made/);
    expect((await db.select().from(buyingDecisions)).every((b) => b.zohoPoId === null)).toBe(true);
  });

  it("is a clear 409 when Zoho is not connected", async () => {
    const { reorders } = await reviewedRun();
    await expect(sendToZoho(db, u.procurement, reorders.map((b) => b.id))).rejects.toMatchObject({ status: 409, code: "ZOHO_NOT_CONNECTED" });
  });

  it.each(ROLES.filter((r) => r !== "procurement"))("%s cannot send to Zoho (403)", async (role) => {
    const { reorders } = await reviewedRun();
    const { zoho, client } = zohoWith();
    await expect(sendToZoho(db, u[role], reorders.map((b) => b.id), { client })).rejects.toMatchObject({ status: 403 });
    expect(zoho.pos.size).toBe(0);
  });

  it("refuses bad ids, unknown orders, placed orders and held orders", async () => {
    const { reorders } = await reviewedRun();
    const { client } = zohoWith();
    await expect(sendToZoho(db, u.procurement, [], { client })).rejects.toMatchObject({ code: "BAD_IDS" });
    await expect(sendToZoho(db, u.procurement, [0], { client })).rejects.toMatchObject({ code: "BAD_IDS" });
    await expect(sendToZoho(db, u.procurement, "x", { client })).rejects.toMatchObject({ code: "BAD_IDS" });
    await expect(sendToZoho(db, u.procurement, [99999], { client })).rejects.toMatchObject({ status: 404 });
    await markPlaced(db, u.procurement, [reorders[0].id], "manual");
    await expect(sendToZoho(db, u.procurement, [reorders[0].id], { client })).rejects.toMatchObject({ code: "NOT_PENDING" });
    // A loss above the kill level stops the automation and holds every pending order.
    await createLossEntry(db, u.priya, { periodStart: "2026-10-01", periodEnd: "2026-10-31", stockoutLossRupees: 3_000_000, overstockWriteoffRupees: 1_000_000 }, { now: new Date("2026-10-23T12:00:00+05:30") });
    await expect(sendToZoho(db, u.procurement, [reorders[1].id], { client })).rejects.toMatchObject({ code: "HELD" });
  });

  it("sending nothing but holds creates nothing in Zoho", async () => {
    const { holds } = await reviewedRun();
    const { zoho, client } = zohoWith();
    const r = await sendToZoho(db, u.procurement, holds.map((b) => b.id), { client });
    expect(r).toMatchObject({ sent: 0, holds: holds.length, purchaseOrders: [] });
    expect(zoho.pos.size).toBe(0);
  });
});

describe("checking Zoho for what procurement issued", () => {
  async function sent() {
    const r = await reviewedRun();
    const z = zohoWith();
    const out = await sendToZoho(db, u.procurement, r.reorders.map((b) => b.id), { client: z.client });
    return { ...r, ...z, out };
  }

  it("a draft that is still a draft changes nothing", async () => {
    const { client, reorders } = await sent();
    const r = await syncFromZoho(db, u.procurement, { client });
    expect(r).toEqual({ placed: 0, stillDraft: reorders.length, reset: 0, errors: [] });
    expect((await db.select().from(buyingDecisions)).filter((b) => b.status === "placed")).toHaveLength(0);
  });

  it("an order issued in Zoho becomes placed here, with the Zoho number as its reference", async () => {
    const { client, zoho, out } = await sent();
    const first = out.purchaseOrders[0];
    zoho.issue(first.id);
    const r = await syncFromZoho(db, u.procurement, { client });
    expect(r.placed).toBe(first.lines);
    const placed = (await db.select().from(buyingDecisions)).filter((b) => b.status === "placed");
    expect(placed).toHaveLength(first.lines);
    for (const p of placed) expect(p).toMatchObject({ sinkRef: first.number, placedBy: u.procurement.id, zohoPoId: first.id });
    const audits = await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.placed"));
    expect(audits).toHaveLength(first.lines);
    expect((audits[0].afterJson as { source: string; orderReference: string })).toMatchObject({ source: "zoho", orderReference: first.number });
  });

  it("syncing twice does not place anything twice", async () => {
    const { client, zoho, out } = await sent();
    zoho.issue(out.purchaseOrders[0].id);
    await syncFromZoho(db, u.procurement, { client });
    const again = await syncFromZoho(db, u.procurement, { client });
    expect(again.placed).toBe(0);
    expect(await count(db, "audit_log")).toBe((await db.select().from(auditLog)).length);
  });

  it("a draft cancelled or deleted in Zoho goes back to 'not sent' so it can be sent again", async () => {
    const { client, zoho, out, reorders } = await sent();
    zoho.setStatus(out.purchaseOrders[0].id, "cancelled");
    if (out.purchaseOrders[1]) zoho.remove(out.purchaseOrders[1].id);
    const r = await syncFromZoho(db, u.procurement, { client });
    const gone = out.purchaseOrders[0].lines + (out.purchaseOrders[1]?.lines ?? 0);
    expect(r.reset).toBe(gone);
    const rows = await db.select().from(buyingDecisions);
    expect(rows.filter((b) => b.action === "REORDER" && !b.zohoPoId)).toHaveLength(gone);
    const resent = await sendToZoho(db, u.procurement, reorders.map((b) => b.id), { client });
    expect(resent.sent).toBe(gone);
  });

  it("a Zoho failure for one order is reported and does not stop the others", async () => {
    const { client, zoho, out } = await sent();
    zoho.issue(out.purchaseOrders[0].id);
    zoho.state.failNextWith = { status: 500, json: { code: 1, message: "Zoho is down" } };
    const r = await syncFromZoho(db, u.procurement, { client });
    expect(r.errors.length).toBeGreaterThanOrEqual(1);
    expect(r.errors[0]).toMatch(/Zoho said: Zoho is down/);
  });

  it.each(ROLES.filter((r) => r !== "procurement"))("%s cannot check Zoho (403)", async (role) => {
    const { client } = await sent();
    await expect(syncFromZoho(db, u[role], { client })).rejects.toMatchObject({ status: 403 });
  });
});
