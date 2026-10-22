import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiDecisions, auditLog, buyingDecisions, reviews, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { amendBuyingDecision } from "@/lib/workflow/buying";
import { bulkAccept, getReviewData, parseReviewRequest, reviewDecision, type ReviewRequest } from "@/lib/workflow/review";
import { fastRules } from "../helpers/ai";
import { count, createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;
let runId: number;

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(async () => {
  await resetRunData(db);
  runId = (await newSeedRun(db, { createdBy: u.raghav.id })).runId;
});

/** The database refused it. Drizzle wraps Postgres's message, so the trigger's text is on `cause`. */
async function expectAppendOnly(statement: PromiseLike<unknown>) {
  const err = (await statement.then(() => null, (e: unknown) => e)) as (Error & { cause?: Error }) | null;
  expect(err, "the statement should have been refused").not.toBeNull();
  expect(String(err!.cause?.message ?? err!.message)).toMatch(/append-only/);
}

const reject = (aiDecisionId: number, change: Record<string, unknown>): ReviewRequest =>
  parseReviewRequest({ aiDecisionId, outcome: "rejected", change });

const goodChange = { flagTypes: ["STOCKOUT_RISK"], action: "REORDER", quantity: 400, reasonCode: "WRONG_QUANTITY", reasonText: "Distributor lead time is short" };

describe("F. nothing reaches buying without a review (G-H1, G-B1)", () => {
  it("a new run has AI decisions pending review and no reviews or buying decisions", async () => {
    expect(await count(db, "ai_decisions")).toBe(7);
    expect(await count(db, "reviews")).toBe(0);
    expect(await count(db, "buying_decisions")).toBe(0);
    const [run] = await db.select().from(runs);
    expect(run.status).toBe("in_review");
    const rows = await db.select({ s: aiDecisions.status }).from(aiDecisions);
    expect(rows.every((r) => r.s === "pending_review")).toBe(true);
  });

  it("the database refuses a buying decision that has no review", async () => {
    await expect(db.insert(buyingDecisions).values({ reviewId: 999, skuId: "SKU001", action: "REORDER", quantity: 750 })).rejects.toThrow();
    expect(await count(db, "buying_decisions")).toBe(0);
  });

  it("there is no auto-approve: leaving decisions alone changes nothing", async () => {
    await new Promise((r) => setTimeout(r, 50));
    expect(await count(db, "reviews")).toBe(0);
    expect(await count(db, "buying_decisions")).toBe(0);
  });
});

describe("F. accept", () => {
  it("creates a buying decision with the AI's action and quantity", async () => {
    const id = await idFor(db, runId, "SKU001");
    const r = await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" });
    expect(r).toMatchObject({ outcome: "accepted", finalAction: "REORDER", finalQty: 750 });
    const [review] = await db.select().from(reviews);
    expect(review).toMatchObject({ outcome: "accepted", reviewerId: u.raghav.id, finalAction: "REORDER", finalQty: 750, reasonCode: null });
    expect(review.finalFlagTypes).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
    const [buy] = await db.select().from(buyingDecisions);
    expect(buy).toMatchObject({ reviewId: review.id, skuId: "SKU001", action: "REORDER", quantity: 750, status: "pending", sink: "csv" });
    const [d] = await db.select().from(aiDecisions).where(eq(aiDecisions.id, id));
    expect(d.status).toBe("reviewed");
  });

  it("a pause is accepted as a pause with quantity 0", async () => {
    const r = await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU006"), outcome: "accepted" });
    expect(r).toMatchObject({ finalAction: "PAUSE_ORDER", finalQty: 0 });
  });

  it("a decision can be reviewed only once", async () => {
    const id = await idFor(db, runId, "SKU001");
    await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" });
    await expect(reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" })).rejects.toMatchObject({ status: 409, code: "ALREADY_REVIEWED" });
    await expect(reviewDecision(db, u.raghav, reject(id, goodChange))).rejects.toMatchObject({ code: "ALREADY_REVIEWED" });
    expect(await count(db, "reviews")).toBe(1);
    expect(await count(db, "buying_decisions")).toBe(1);
  });

  it("two reviews at the same moment produce exactly one", async () => {
    const id = await idFor(db, runId, "SKU003");
    const results = await Promise.allSettled([
      reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" }),
      reviewDecision(db, u.admin, { aiDecisionId: id, outcome: "accepted" }),
    ]);
    expect(results.filter((r) => r.status === "fulfilled")).toHaveLength(1);
    expect(await count(db, "reviews")).toBe(1);
  });

  it("an unknown decision is a 404", async () => {
    await expect(reviewDecision(db, u.raghav, { aiDecisionId: 9999, outcome: "accepted" })).rejects.toMatchObject({ status: 404 });
  });

  it("a decision voided by a kill cannot be reviewed", async () => {
    const id = await idFor(db, runId, "SKU001");
    await db.update(aiDecisions).set({ status: "voided_by_kill" }).where(eq(aiDecisions.id, id));
    await expect(reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" })).rejects.toMatchObject({ code: "DECISION_VOIDED" });
  });
});

describe("F. reject (G-H2, G-H3)", () => {
  it("is refused without a reason code", () => {
    expect(() => parseReviewRequest({ aiDecisionId: 1, outcome: "rejected", change: { ...goodChange, reasonCode: undefined } })).toThrow(/reason code is required/);
    expect(() => parseReviewRequest({ aiDecisionId: 1, outcome: "rejected", change: { ...goodChange, reasonCode: "BECAUSE" } })).toThrow(/reason code is required/);
    expect(() => parseReviewRequest({ aiDecisionId: 1, outcome: "rejected" })).toThrow(/what the flag and decision should be/);
  });

  it("needs reason text when the code is OTHER", () => {
    expect(() => reject(1, { ...goodChange, reasonCode: "OTHER", reasonText: "   " })).toThrow(/Write a reason/);
    expect(reject(1, { ...goodChange, reasonCode: "OTHER", reasonText: "Customer called" }).outcome).toBe("rejected");
  });

  it("reason text is optional for the other codes", () => {
    expect(reject(1, { ...goodChange, reasonText: undefined }).outcome).toBe("rejected");
  });

  it("is refused when nothing differs from the AI decision", async () => {
    const id = await idFor(db, runId, "SKU001");
    await expect(reviewDecision(db, u.raghav, reject(id, { ...goodChange, action: "REORDER", quantity: 750 }))).rejects.toMatchObject({ code: "NO_CHANGE" });
    // Changing only the flag is not a change to the decision either.
    await expect(reviewDecision(db, u.raghav, reject(id, { ...goodChange, flagTypes: [], action: "REORDER", quantity: 750 }))).rejects.toMatchObject({ code: "NO_CHANGE" });
    expect(await count(db, "reviews")).toBe(0);
    const [d] = await db.select().from(aiDecisions).where(eq(aiDecisions.id, id));
    expect(d.status).toBe("pending_review"); // the failed attempt left no trace
  });

  it("creates a buying decision with Raghav's final action and quantity, and stores flag, decision, reason code and text", async () => {
    const id = await idFor(db, runId, "SKU001");
    const r = await reviewDecision(db, u.raghav, reject(id, goodChange));
    expect(r).toMatchObject({ outcome: "rejected", finalAction: "REORDER", finalQty: 400 });
    const [review] = await db.select().from(reviews);
    expect(review).toMatchObject({
      outcome: "rejected",
      finalAction: "REORDER",
      finalQty: 400,
      reasonCode: "WRONG_QUANTITY",
      reasonText: "Distributor lead time is short",
    });
    expect(review.finalFlagTypes).toEqual(["STOCKOUT_RISK"]);
    const [buy] = await db.select().from(buyingDecisions);
    expect(buy).toMatchObject({ skuId: "SKU001", action: "REORDER", quantity: 400 });
  });

  it("can change a reorder into a pause or into no action", async () => {
    const a = await reviewDecision(db, u.raghav, reject(await idFor(db, runId, "SKU003"), { flagTypes: [], action: "PAUSE_ORDER", quantity: 0, reasonCode: "MARKET_EVENT" }));
    const b = await reviewDecision(db, u.raghav, reject(await idFor(db, runId, "SKU004"), { flagTypes: [], action: "NO_ACTION", quantity: 0, reasonCode: "DATA_LOOKS_WRONG" }));
    expect([a.finalAction, b.finalAction]).toEqual(["PAUSE_ORDER", "NO_ACTION"]);
    const buys = await db.select().from(buyingDecisions);
    expect(buys.map((x) => [x.skuId, x.action, x.quantity])).toEqual([["SKU003", "PAUSE_ORDER", 0], ["SKU004", "NO_ACTION", 0]]);
  });

  it("enforces quantity rules whoever sets them (G-B5)", async () => {
    const id = await idFor(db, runId, "SKU001");
    await expect(reviewDecision(db, u.raghav, reject(id, { ...goodChange, quantity: 0 }))).rejects.toMatchObject({ code: "BAD_QUANTITY" });
    await expect(reviewDecision(db, u.raghav, reject(id, { ...goodChange, action: "PAUSE_ORDER", quantity: 5 }))).rejects.toMatchObject({ code: "BAD_QUANTITY" });
    await expect(reviewDecision(db, u.raghav, reject(id, { ...goodChange, action: "NO_ACTION", quantity: 5 }))).rejects.toMatchObject({ code: "BAD_QUANTITY" });
    expect(() => reject(id, { ...goodChange, quantity: 1.5 })).toThrow(/whole number/);
    expect(() => reject(id, { ...goodChange, quantity: -3 })).toThrow(/whole number/);
    expect(() => reject(id, { ...goodChange, flagTypes: ["MADE_UP"] })).toThrow(/flagTypes/);
    expect(() => reject(id, { ...goodChange, action: "BUY" })).toThrow(/action must be/);
    expect(await count(db, "reviews")).toBe(0);
  });
});

describe("F. bulk accept (G-H4, G-H5)", () => {
  it("accepts a list of plain AI decisions, all or nothing", async () => {
    const ids = [await idFor(db, runId, "SKU003"), await idFor(db, runId, "SKU004"), await idFor(db, runId, "SKU006")];
    const results = await bulkAccept(db, u.raghav, ids);
    expect(results).toHaveLength(3);
    expect(await count(db, "reviews")).toBe(3);
    expect(await count(db, "buying_decisions")).toBe(3);
  });

  it("a whole-run bulk accept writes the same rows as accepting one by one, and completes the run", async () => {
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    const results = await bulkAccept(db, u.raghav, ids);
    expect(results.map((r) => r.aiDecisionId)).toEqual(ids); // results follow the request order
    expect(results.every((r) => r.runCompleted)).toBe(true);
    expect(await count(db, "reviews")).toBe(7);
    expect(await count(db, "buying_decisions")).toBe(7);
    const buys = await db.select().from(buyingDecisions).orderBy(buyingDecisions.skuId);
    expect(buys.map((b) => `${b.skuId} ${b.action} ${b.quantity}`)).toEqual([
      "SKU001 REORDER 750", "SKU003 REORDER 300", "SKU004 REORDER 150", "SKU006 PAUSE_ORDER 0", "SKU007 PAUSE_ORDER 0", "SKU011 REORDER 500", "SKU013 REORDER 120",
    ]);
    const accepted = await db.select().from(auditLog).where(eq(auditLog.action, "review.accepted"));
    expect(accepted).toHaveLength(7);
    expect(accepted.every((a) => a.actorId === u.raghav.id)).toBe(true);
    expect((await db.select().from(runs))[0].status).toBe("completed");
    const rev = await db.select().from(reviews).orderBy(reviews.id);
    expect(rev.every((r) => r.outcome === "accepted" && r.reviewerId === u.raghav.id && r.reasonCode === null)).toBe(true);
    expect(rev.find((r) => r.finalAction === "REORDER" && r.finalQty === 750)?.finalFlagTypes).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
  });

  it("an admin's bulk accept is audited as break-glass for every decision", async () => {
    const ids = [await idFor(db, runId, "SKU003"), await idFor(db, runId, "SKU004")];
    await bulkAccept(db, u.admin, ids);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "review.break_glass"))).toHaveLength(2);
  });

  it("a bulk accept that loses a race to a single review changes nothing", async () => {
    const a = await idFor(db, runId, "SKU003");
    const b = await idFor(db, runId, "SKU004");
    const [bulkResult, single] = await Promise.allSettled([
      bulkAccept(db, u.raghav, [a, b]),
      reviewDecision(db, u.raghav, { aiDecisionId: b, outcome: "accepted" }),
    ]);
    // Exactly the decisions that were accepted have a review; nothing is half-done.
    const reviewed = await count(db, "reviews");
    const buying = await count(db, "buying_decisions");
    expect(buying).toBe(reviewed);
    if (bulkResult.status === "fulfilled") expect(reviewed).toBe(single.status === "fulfilled" ? 3 : 2);
    else expect(reviewed).toBe(1);
  });

  it("refuses the whole batch if one decision is already reviewed", async () => {
    const a = await idFor(db, runId, "SKU003");
    const b = await idFor(db, runId, "SKU004");
    await reviewDecision(db, u.raghav, { aiDecisionId: a, outcome: "accepted" });
    await expect(bulkAccept(db, u.raghav, [a, b])).rejects.toMatchObject({ status: 409, code: "NOT_PENDING" });
    expect(await count(db, "reviews")).toBe(1);
  });

  it("refuses needs-judgment decisions", async () => {
    const id = await idFor(db, runId, "SKU003");
    await db.update(aiDecisions).set({ needsJudgment: true }).where(eq(aiDecisions.id, id));
    await expect(bulkAccept(db, u.raghav, [id, await idFor(db, runId, "SKU004")])).rejects.toMatchObject({ code: "BULK_NOT_ALLOWED" });
    expect(await count(db, "reviews")).toBe(0); // nothing accepted, not even the eligible one
  });

  it("refuses fallback decisions", async () => {
    const id = await idFor(db, runId, "SKU003");
    await db.update(aiDecisions).set({ isFallback: true, valid: false }).where(eq(aiDecisions.id, id));
    await expect(bulkAccept(db, u.raghav, [id])).rejects.toMatchObject({ code: "BULK_NOT_ALLOWED" });
  });

  it("can still review a needs-judgment decision one by one", async () => {
    const id = await idFor(db, runId, "SKU003");
    await db.update(aiDecisions).set({ needsJudgment: true }).where(eq(aiDecisions.id, id));
    await expect(reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" })).resolves.toBeTruthy();
  });

  it.each([[[]], ["x"], [[1, "2"]], [[0]], [[-1]]])("rejects a bad id list %j", async (bad) => {
    await expect(bulkAccept(db, u.raghav, bad)).rejects.toMatchObject({ status: 400 });
  });

  it("an unknown id is a 404", async () => {
    await expect(bulkAccept(db, u.raghav, [9999])).rejects.toMatchObject({ status: 404 });
  });
});

describe("F. who may review (G-H7)", () => {
  it.each(["procurement", "priya", "deepa", "ceo"] as const)("%s is refused (403) and nothing changes", async (role) => {
    const id = await idFor(db, runId, "SKU001");
    await expect(reviewDecision(db, u[role], { aiDecisionId: id, outcome: "accepted" })).rejects.toMatchObject({ status: 403 });
    await expect(bulkAccept(db, u[role], [id])).rejects.toMatchObject({ status: 403 });
    await expect(reviewDecision(db, u[role], reject(id, goodChange))).rejects.toMatchObject({ status: 403 });
    expect(await count(db, "reviews")).toBe(0);
  });

  it("an admin may review as a break-glass action, and it is audit-logged", async () => {
    const id = await idFor(db, runId, "SKU001");
    await reviewDecision(db, u.admin, { aiDecisionId: id, outcome: "accepted" });
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "review.break_glass"));
    expect(log).toHaveLength(1);
    expect(log[0]).toMatchObject({ actorId: u.admin.id, entity: "ai_decision", entityId: String(id) });
  });

  it("a normal review by Raghav is not logged as break-glass", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "review.break_glass"))).toHaveLength(0);
  });
});

describe("F. reviews are append-only; a later change is an audit entry (G-H6)", () => {
  it("the database refuses to update or delete a review", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    await expectAppendOnly(db.update(reviews).set({ finalQty: 1 }));
    await expectAppendOnly(db.delete(reviews));
    const [r] = await db.select().from(reviews);
    expect(r.finalQty).toBe(750);
  });

  it("the audit log and AI decisions cannot be altered or deleted either", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    await expectAppendOnly(db.update(auditLog).set({ action: "x" }));
    await expectAppendOnly(db.delete(auditLog));
    await expectAppendOnly(db.delete(aiDecisions));
    // AI decisions may change status (pending to reviewed), just never be deleted.
    await expect(db.update(aiDecisions).set({ status: "reviewed" })).resolves.toBeDefined();
  });

  it("amending a buying decision after review writes an audit entry with before, after and the reason", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    const [buy] = await db.select().from(buyingDecisions);
    await amendBuyingDecision(db, u.raghav, buy.id, { action: "REORDER", quantity: 600, reason: "Supplier confirmed a smaller batch" });
    const [after] = await db.select().from(buyingDecisions);
    expect(after).toMatchObject({ action: "REORDER", quantity: 600 });
    const log = await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.amended"));
    expect(log).toHaveLength(1);
    expect(log[0].beforeJson).toEqual({ action: "REORDER", quantity: 750 });
    expect(log[0].afterJson).toEqual({ action: "REORDER", quantity: 600, reason: "Supplier confirmed a smaller batch" });
    // The review row itself is untouched.
    expect((await db.select().from(reviews))[0].finalQty).toBe(750);
  });

  it("an amendment needs a reason, a real change, and an order not yet placed", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    const [buy] = await db.select().from(buyingDecisions);
    await expect(amendBuyingDecision(db, u.raghav, buy.id, { action: "REORDER", quantity: 600, reason: "short" })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    await expect(amendBuyingDecision(db, u.raghav, buy.id, { action: "REORDER", quantity: 750, reason: "No real change here" })).rejects.toMatchObject({ code: "NO_CHANGE" });
    await db.update(buyingDecisions).set({ status: "placed" }).where(eq(buyingDecisions.id, buy.id));
    await expect(amendBuyingDecision(db, u.raghav, buy.id, { action: "REORDER", quantity: 600, reason: "Too late to change this" })).rejects.toMatchObject({ code: "NOT_AMENDABLE" });
    await expect(amendBuyingDecision(db, u.raghav, 9999, { action: "REORDER", quantity: 600, reason: "Does not exist here" })).rejects.toMatchObject({ status: 404 });
  });

  it("only Raghav (or an audited admin) can amend", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU001"), outcome: "accepted" });
    const [buy] = await db.select().from(buyingDecisions);
    for (const role of ["procurement", "priya", "deepa", "ceo"] as const) {
      await expect(amendBuyingDecision(db, u[role], buy.id, { action: "REORDER", quantity: 600, reason: "Trying to sneak a change" })).rejects.toMatchObject({ status: 403 });
    }
  });

  it("every review writes an audit entry with actor, before and after", async () => {
    const id = await idFor(db, runId, "SKU001");
    await reviewDecision(db, u.raghav, reject(id, goodChange));
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "review.rejected"));
    expect(entry).toMatchObject({ actorId: u.raghav.id, entity: "ai_decision", entityId: String(id) });
    expect(entry.beforeJson).toMatchObject({ action: "REORDER", quantity: 750 });
    expect(entry.afterJson).toMatchObject({ action: "REORDER", quantity: 400, reasonCode: "WRONG_QUANTITY" });
  });
});

describe("F. the run completes when every decision has a review", () => {
  it("moves from in_review to completed on the last review", async () => {
    const rows = await db.select({ id: aiDecisions.id }).from(aiDecisions);
    for (const [i, row] of rows.entries()) {
      const r = await reviewDecision(db, u.raghav, { aiDecisionId: row.id, outcome: "accepted" });
      expect(r.runCompleted).toBe(i === rows.length - 1);
    }
    expect((await db.select().from(runs))[0].status).toBe("completed");
  });

  it("a run with no flags is completed at once and has nothing to review", async () => {
    await resetRunData(db);
    // Thresholds under which nothing on the seed can be flagged.
    const rules = fastRules((c) => {
      c.rules.stockout_cover_weeks = 0;
      c.rules.overstock_cover_weeks = 1_000_000;
      c.rules.perishable.min_cover_weeks = 0;
      c.rules.perishable.max_cover_weeks = 1_000_000;
      c.rules.high_demand_threshold_pct = 10_000;
    });
    const run = await startSeedRun(db, u.raghav, { rules });
    expect(run).toMatchObject({ flagCount: 0, status: "completed", fallbackCount: 0 });
    expect(await count(db, "ai_decisions")).toBe(0);
  });
});

describe("F. the review page data", () => {
  it("counts and orders the items, pending first, stockout before high demand before overstock", async () => {
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, runId, "SKU004"), outcome: "accepted" });
    await reviewDecision(db, u.raghav, reject(await idFor(db, runId, "SKU013"), { ...goodChange, flagTypes: [], action: "NO_ACTION", quantity: 0 }));
    const data = await getReviewData(db, runId);
    expect(data.counts).toEqual({ total: 7, pending: 5, accepted: 1, rejected: 1, voided: 0, fallback: 0 });
    expect(data.items.map((i) => i.skuId)).toEqual(["SKU001", "SKU003", "SKU011", "SKU006", "SKU007", "SKU004", "SKU013"]);
    expect(data.run).toMatchObject({ asOfDate: "2026-10-19", isFestival: true, fallbackWarning: false, rulesVersion: expect.any(String) });
    const rejected = data.items.find((i) => i.skuId === "SKU013")!;
    expect(rejected.review).toMatchObject({ outcome: "rejected", finalAction: "NO_ACTION" });
    expect(data.items[0]).toMatchObject({ skuName: "Freshroots Mango Drink 200ml", needsJudgment: false, isFallback: false });
  });

  it("puts needs-judgment items first", async () => {
    const id = await idFor(db, runId, "SKU007");
    await db.update(aiDecisions).set({ needsJudgment: true }).where(eq(aiDecisions.id, id));
    const data = await getReviewData(db, runId);
    expect(data.items[0].skuId).toBe("SKU007");
  });

  it("a missing run is a 404", async () => {
    await expect(getReviewData(db, 9999)).rejects.toMatchObject({ status: 404 });
  });
});

it("the stored AI decisions equal the rule engine's action and quantity (default policy)", async () => {
  const rows = await db.select({ a: aiDecisions.action, q: aiDecisions.quantity }).from(aiDecisions);
  expect(rows.map((r) => `${r.a} ${r.q}`).sort()).toEqual(
    ["PAUSE_ORDER 0", "PAUSE_ORDER 0", "REORDER 120", "REORDER 150", "REORDER 300", "REORDER 500", "REORDER 750"].sort(),
  );
});
