import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiDecisions, auditLog, buyingDecisions, dataSnapshots, emailOutbox, flags, killEvents, reviews, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { evaluateKill1AndAct, getKillStatus, rearmKill } from "@/lib/kill/service";
import { markPlaced } from "@/lib/workflow/orders";
import { reviewDecision, bulkAccept, type ReviewRequest } from "@/lib/workflow/review";
import { releaseHeld } from "@/lib/workflow/buying";
import { fastRules } from "../helpers/ai";
import { count, createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));

/** Inserts already-reviewed AI decisions directly, so the counting rule can be tested at any size. */
async function seedReviewed(opts: { valid: number; reversed: number; fallback?: number; fallbackReversed?: number }) {
  const fallback = opts.fallback ?? 0;
  const [snap] = await db.insert(dataSnapshots).values({ asOfDate: "2026-10-19", rawFilesJson: {}, validationReportJson: {} }).returning({ id: dataSnapshots.id });
  const [run] = await db
    .insert(runs)
    .values({ snapshotId: snap.id, rulesVersion: "test", rulesJson: {}, status: "completed", summaryJson: { as_of_date: "2026-10-19", is_festival: false, skipped: [] } })
    .returning({ id: runs.id });
  const total = opts.valid + fallback;
  if (total === 0) return;
  const flagRows = await db
    .insert(flags)
    .values(
      Array.from({ length: total }, (_, i) => ({
        runId: run.id, skuId: `SKU${i}`, flagTypes: ["STOCKOUT_RISK"], avgWeeklySales: 1, recentAvg: 1, demandRatio: 1, uplift: 1, demandRate: 1,
        unitsOnHand: 1, coverWeeks: 1, minCover: 6, maxCover: 14, standardQty: 100, multiplier: 1, ruleAction: "REORDER" as const, ruleQty: 100, needsJudgment: false, judgmentReasons: [],
      })),
    )
    .returning({ id: flags.id });
  const decisions = await db
    .insert(aiDecisions)
    .values(
      flagRows.map((f, i) => ({
        flagId: f.id, status: "reviewed" as const, model: "m", promptVersion: "v", action: "REORDER" as const, quantity: 100, explanation: "x",
        confidence: i < opts.valid ? ("HIGH" as const) : null, needsJudgment: false, valid: i < opts.valid, invalidReasons: [], isFallback: i >= opts.valid,
        inputJson: {}, attemptsJson: [], latencyMs: 1,
      })),
    )
    .returning({ id: aiDecisions.id });
  await db.insert(reviews).values(
    decisions.map((d, i) => {
      const isFallback = i >= opts.valid;
      const rejected = isFallback ? i - opts.valid < (opts.fallbackReversed ?? 0) : i < opts.reversed;
      return {
        aiDecisionId: d.id, reviewerId: u.raghav.id, outcome: rejected ? ("rejected" as const) : ("accepted" as const),
        finalAction: "REORDER" as const, finalQty: rejected ? 50 : 100, finalFlagTypes: ["STOCKOUT_RISK"],
        reasonCode: rejected ? ("WRONG_QUANTITY" as const) : null,
      };
    }),
  );
}

describe("G. Kill 1 against real review counts (docs/10-TEST-PLAN.md table)", () => {
  it.each([
    [29, 10, false],
    [30, 2, false],
    [30, 3, true],
    [100, 9, false],
    [100, 10, true],
  ])("%i reviewed, %i reversed -> killed=%s", async (valid, reversed, killed) => {
    await seedReviewed({ valid, reversed });
    const out = await evaluateKill1AndAct(db);
    expect(out.fired).toBe(killed);
    expect((await getKillStatus(db)).kill1.state).toBe(killed ? "killed" : "armed");
    expect(await count(db, "kill_events")).toBe(killed ? 1 : 0);
  });

  it("30 valid and 20 fallback with 3 reversed of the valid ones: KILL, because fallbacks are excluded", async () => {
    await seedReviewed({ valid: 30, reversed: 3, fallback: 20 });
    const out = await evaluateKill1AndAct(db);
    expect(out.fired).toBe(true);
    expect(out.result).toMatchObject({ reviewed: 30, reversed: 3 }); // not 50
  });

  it("fallback reversals never count: 30 valid, 2 reversed, 20 fallback all reversed is still fine", async () => {
    await seedReviewed({ valid: 30, reversed: 2, fallback: 20, fallbackReversed: 20 });
    const out = await evaluateKill1AndAct(db);
    expect(out.fired).toBe(false);
    expect(out.result).toMatchObject({ reviewed: 30, reversed: 2 });
  });

  it("a switch turned off in config never fires", async () => {
    await seedReviewed({ valid: 100, reversed: 100 });
    const rules = fastRules((c) => (c.kill_switch_1.enabled = false));
    expect((await evaluateKill1AndAct(db, { rules })).fired).toBe(false);
  });

  it("evaluating twice creates one event, not two (idempotent)", async () => {
    await seedReviewed({ valid: 30, reversed: 5 });
    const [a, b] = await Promise.all([evaluateKill1AndAct(db), evaluateKill1AndAct(db)]);
    expect([a.fired, b.fired].filter(Boolean)).toHaveLength(1);
    await evaluateKill1AndAct(db);
    expect(await count(db, "kill_events")).toBe(1);
    expect(await count(db, "email_outbox")).toBe(4);
  });

  it("only reviews since the epoch count, and the status shows 'collecting' below the minimum", async () => {
    await seedReviewed({ valid: 12, reversed: 6 });
    const status = await getKillStatus(db);
    expect(status.kill1.result).toMatchObject({ verdict: "collecting", reviewed: 12, reversed: 6, minReviewed: 30 });
    expect(status.stopped).toBe(false);
  });
});

describe("G. Kill 1 fires from real review actions, and what 'killed' does", () => {
  /** Five seed runs: 35 AI decisions waiting. Run 1 is reviewed first so one order can be placed before the kill. */
  async function setup() {
    const runIds: number[] = [];
    for (let i = 0; i < 5; i++) runIds.push((await newSeedRun(db, { createdBy: u.raghav.id })).runId);
    const pending = await db.select({ id: aiDecisions.id, sku: flags.skuId, runId: flags.runId }).from(aiDecisions).innerJoin(flags, eq(flags.id, aiDecisions.flagId)).orderBy(aiDecisions.id);
    return { runIds, pending };
  }
  const reject = (aiDecisionId: number): ReviewRequest =>
    ({ aiDecisionId, outcome: "rejected", change: { flagTypes: ["STOCKOUT_RISK"], action: "REORDER", quantity: 1, reasonCode: "WRONG_QUANTITY" } }) as unknown as ReviewRequest;

  async function reachKill() {
    const { pending, runIds } = await setup();
    const rejectIds = pending.filter((p) => p.sku === "SKU001").slice(0, 3).map((p) => p.id); // three reorders to change
    const order = [...rejectIds, ...pending.filter((p) => !rejectIds.includes(p.id)).map((p) => p.id)];
    let last = null;
    for (let i = 0; i < 30; i++) {
      const id = order[i];
      last = await reviewDecision(db, u.raghav, rejectIds.includes(id) ? reject(id) : { aiDecisionId: id, outcome: "accepted" });
      if (i < 29) expect(last.kill1Fired).toBe(false);
    }
    return { last: last!, pending, runIds, remaining: order.slice(30) };
  }

  it("the 30th review with 3 reversals fires Kill 1 inside that review", async () => {
    const { last } = await reachKill();
    expect(last.kill1Fired).toBe(true);
    const status = await getKillStatus(db);
    expect(status).toMatchObject({ stopped: true, stoppedBy: [1] });
    expect(status.kill1.result).toMatchObject({ reviewed: 30, reversed: 3, ratePct: 10 });
  });

  it("voids every unreviewed decision, holds unplaced orders (never cancels), and blocks open reviews", async () => {
    const { remaining } = await reachKill();
    const rows = await db.select({ id: aiDecisions.id, s: aiDecisions.status }).from(aiDecisions);
    expect(rows.filter((r) => r.s === "voided_by_kill").map((r) => r.id).sort((a, b) => a - b)).toEqual([...remaining].sort((a, b) => a - b));
    expect(rows.filter((r) => r.s === "reviewed")).toHaveLength(30);
    const buys = await db.select({ s: buyingDecisions.status }).from(buyingDecisions);
    expect(buys).toHaveLength(30);
    expect(buys.every((b) => b.s === "held")).toBe(true);
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.status, "cancelled")))).toHaveLength(0);
    const blocked = await db.select().from(runs).where(eq(runs.status, "blocked"));
    expect(blocked).toHaveLength(1); // the one run still open; fully reviewed runs stay completed
  });

  it("an order already placed before the kill stays placed", async () => {
    const { pending } = await setup();
    const first = pending[0];
    await reviewDecision(db, u.raghav, { aiDecisionId: first.id, outcome: "accepted" });
    const [buy] = await db.select().from(buyingDecisions);
    await markPlaced(db, u.procurement, [buy.id], "PO-1");
    await seedReviewed({ valid: 30, reversed: 10 });
    await evaluateKill1AndAct(db);
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, buy.id)))[0].status).toBe("placed");
  });

  it("blocks new runs and the AI step with the stop message", async () => {
    await reachKill();
    await expect(startSeedRun(db, u.raghav)).rejects.toMatchObject({ status: 409, code: "AUTOMATION_STOPPED", message: expect.stringContaining("Automation stopped (Kill 1). Use the previous process.") });
    await expect(newSeedRun(db, { createdBy: u.raghav.id })).rejects.toMatchObject({ code: "AUTOMATION_STOPPED" });
  });

  it("a voided decision can no longer be reviewed", async () => {
    const { remaining } = await reachKill();
    await expect(reviewDecision(db, u.raghav, { aiDecisionId: remaining[0], outcome: "accepted" })).rejects.toMatchObject({ code: "DECISION_VOIDED" });
    await expect(bulkAccept(db, u.raghav, [remaining[0]])).rejects.toMatchObject({ status: 409 });
  });

  it("writes the kill event, the audit entry and one email each to Raghav, Deepa, the CEO and Priya", async () => {
    await reachKill();
    const [event] = await db.select().from(killEvents);
    expect(event).toMatchObject({ killSwitch: 1, event: "killed", metricValue: 10, threshold: 10 });
    expect(event.detailsJson).toMatchObject({ reviewed: 30, reversed: 3, voided: 5 });
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "kill1.fired")))).toHaveLength(1);
    const mails = await db.select().from(emailOutbox);
    expect(mails.map((m) => m.toEmail).sort()).toEqual(["ceo@freshroots.test", "deepa@freshroots.test", "priya@freshroots.test", "raghav@freshroots.test"]);
    expect(mails.every((m) => m.kind === "kill1.killed" && m.killEventId === event.id)).toBe(true);
    expect(mails[0].subject).toBe("Freshroots automation stopped (Kill 1)");
    expect(mails[0].body).toContain("Automation stopped (Kill 1). Use the previous process.");
    expect(mails[0].body).toContain("3 of 30");
  });

  it("emails were delivered after commit (console provider in tests)", async () => {
    await reachKill();
    const mails = await db.select().from(emailOutbox);
    expect(mails.every((m) => m.status === "sent" && m.sentAt)).toBe(true);
  });

  it("a run records the kill state it started under", async () => {
    const run = await startSeedRun(db, u.raghav);
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].killStateAtRun).toBe("kill1:armed;kill2:green");
  });

  it("a bulk accept that lifts the count to 30 can fire the switch too", async () => {
    await seedReviewed({ valid: 29, reversed: 3 }); // 29 reviewed, 3 reversed: still collecting
    expect((await getKillStatus(db)).stopped).toBe(false);
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const results = await bulkAccept(db, u.raghav, [await idFor(db, run.runId, "SKU003")]); // the 30th review
    expect(results[0].kill1Fired).toBe(true);
    expect((await getKillStatus(db)).stoppedBy).toEqual([1]);
  });
});

describe("G. re-arm (G-K3)", () => {
  const REASON = "Reviewed the reversals with Raghav; rules were updated";

  async function killedByCounts() {
    await seedReviewed({ valid: 30, reversed: 6 });
    await evaluateKill1AndAct(db);
  }

  it.each(["deepa", "ceo"] as const)("%s can re-arm with a reason of 20 or more characters: the count restarts", async (role) => {
    await killedByCounts();
    const before = (await getKillStatus(db)).kill1.epochStart;
    const res = await rearmKill(db, u[role], { which: 1, reason: REASON });
    expect(res).toMatchObject({ which: 1, state: "armed" });
    const status = await getKillStatus(db);
    expect(status.stopped).toBe(false);
    expect(status.kill1.epochStart.getTime()).toBeGreaterThan(before.getTime());
    expect(status.kill1.result).toMatchObject({ verdict: "collecting", reviewed: 0, reversed: 0 });
    // Past data is kept.
    expect(await count(db, "reviews")).toBe(30);
    const events = await db.select().from(killEvents).orderBy(killEvents.id);
    expect(events.map((e) => e.event)).toEqual(["killed", "rearmed"]);
    expect(events[1].detailsJson).toMatchObject({ reason: REASON, by: u[role].email, role });
    const audit = await db.select().from(auditLog).where(eq(auditLog.action, "kill.rearmed"));
    expect(audit).toHaveLength(1);
    expect(audit[0].actorId).toBe(u[role].id);
  });

  it.each(ROLES.filter((r) => r !== "deepa" && r !== "ceo"))("%s gets 403", async (role) => {
    await killedByCounts();
    await expect(rearmKill(db, u[role], { which: 1, reason: REASON })).rejects.toMatchObject({ status: 403 });
    expect((await getKillStatus(db)).stopped).toBe(true);
  });

  it("needs a written reason of at least 20 characters", async () => {
    await killedByCounts();
    for (const reason of ["", "   ", "too short", "x".repeat(19), 42, undefined]) {
      await expect(rearmKill(db, u.deepa, { which: 1, reason })).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    }
    await expect(rearmKill(db, u.deepa, { which: 1, reason: "x".repeat(20) })).resolves.toBeTruthy();
  });

  it("refuses a switch that is not stopped, and an unknown switch", async () => {
    await expect(rearmKill(db, u.deepa, { which: 1, reason: REASON })).rejects.toMatchObject({ status: 409, code: "NOT_KILLED" });
    await expect(rearmKill(db, u.deepa, { which: 3, reason: REASON })).rejects.toMatchObject({ code: "BAD_SWITCH" });
  });

  it("after a re-arm new runs work again, and the count really restarts from zero", async () => {
    await killedByCounts();
    await expect(startSeedRun(db, u.raghav)).rejects.toMatchObject({ code: "AUTOMATION_STOPPED" });
    await rearmKill(db, u.deepa, { which: 1, reason: REASON });
    const run = await startSeedRun(db, u.raghav);
    expect(run.flagCount).toBe(7);
    // 29 more reviews are collecting data, not killing, even though the old 6 reversals are still in the table.
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions).where(eq(aiDecisions.status, "pending_review"))).map((r) => r.id);
    await bulkAccept(db, u.raghav, ids);
    expect((await getKillStatus(db)).stopped).toBe(false);
  });

  it("re-arming does not undo what the kill did: voided stays voided, held stays held until Raghav confirms", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU003"), outcome: "accepted" });
    await seedReviewed({ valid: 30, reversed: 6 });
    await evaluateKill1AndAct(db);
    await rearmKill(db, u.ceo, { which: 1, reason: REASON });
    const [held] = await db.select().from(buyingDecisions);
    expect(held.status).toBe("held");
    expect((await db.select().from(aiDecisions).where(eq(aiDecisions.status, "voided_by_kill"))).length).toBe(6);
    await expect(markPlaced(db, u.procurement, [held.id], null)).rejects.toMatchObject({ code: "HELD" });
  });
});

describe("G. held orders are released only by Raghav's written confirmation (open question 39)", () => {
  async function heldOrder() {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU003"), outcome: "accepted" });
    await seedReviewed({ valid: 30, reversed: 6 });
    await evaluateKill1AndAct(db);
    return (await db.select().from(buyingDecisions))[0];
  }

  it("Raghav confirms: the order goes back to pending, audited with his reason, and procurement can place it", async () => {
    const order = await heldOrder();
    await expect(releaseHeld(db, u.raghav, [order.id], "Checked with the distributor, safe to order")).resolves.toEqual({ released: 1 });
    expect((await db.select().from(buyingDecisions).where(eq(buyingDecisions.id, order.id)))[0].status).toBe("pending");
    const [entry] = await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.released"));
    expect(entry).toMatchObject({ actorId: u.raghav.id, entityId: String(order.id) });
    expect(entry.afterJson).toMatchObject({ status: "pending", reason: "Checked with the distributor, safe to order" });
    await expect(markPlaced(db, u.procurement, [order.id], "PO-77")).resolves.toMatchObject({ placed: 1 });
  });

  it("needs a reason, only works on held orders, and only Raghav (or an audited admin) can do it", async () => {
    const order = await heldOrder();
    await expect(releaseHeld(db, u.raghav, [order.id], "short")).rejects.toMatchObject({ code: "REASON_REQUIRED" });
    for (const role of ["procurement", "priya", "deepa", "ceo"] as const) {
      await expect(releaseHeld(db, u[role], [order.id], "I would like to order this please")).rejects.toMatchObject({ status: 403 });
    }
    await releaseHeld(db, u.raghav, [order.id], "Confirmed by phone with Raghav");
    await expect(releaseHeld(db, u.raghav, [order.id], "Trying a second time now")).rejects.toMatchObject({ code: "NOT_HELD" });
    await expect(releaseHeld(db, u.raghav, [99999], "This order does not exist here")).rejects.toMatchObject({ status: 404 });
    await expect(releaseHeld(db, u.raghav, [], "Nothing to release at all")).rejects.toMatchObject({ code: "BAD_IDS" });
  });
});
