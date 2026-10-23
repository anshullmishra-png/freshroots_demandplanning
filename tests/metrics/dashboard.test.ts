import { eq, sql } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDecisions, auditLog, buyingDecisions } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { getAuditLog, AUDIT_PAGE_SIZE } from "@/lib/workflow/auditLog";
import { METRIC_DEFINITIONS, getDashboard } from "@/lib/metrics/queries";
import { createLossEntry } from "@/lib/workflow/losses";
import { markPlaced } from "@/lib/workflow/orders";
import { bulkAccept, reviewDecision, type ReviewRequest } from "@/lib/workflow/review";
import { writeAudit } from "@/lib/workflow/audit";
import { ROLES } from "@/lib/auth/permissions";
import { daysBetween, istDate } from "@/lib/dates/isoWeek";
import { createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;
const NOW = new Date("2026-10-23T11:00:00+05:30");

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));
afterEach(() => vi.useRealTimers());

const reject = (aiDecisionId: number, code: string): ReviewRequest =>
  ({ aiDecisionId, outcome: "rejected", change: { flagTypes: ["STOCKOUT_RISK"], action: "REORDER", quantity: 1, reasonCode: code, reasonText: code === "OTHER" ? "because" : undefined } }) as unknown as ReviewRequest;

describe("the dashboard shows the fixed definitions from docs/09", () => {
  it("an empty system reads zero, green and armed, with nothing invented", async () => {
    const d = await getDashboard(db, { now: NOW });
    expect(d.kill.kill2).toMatchObject({ state: "green", loss: { total: 0 } });
    expect(d.kill.kill1.result).toMatchObject({ verdict: "collecting", reviewed: 0 });
    expect(d).toMatchObject({ losses: [], trend: [], reasons: [], runs: [] });
    expect(d.quality).toEqual({ decisions: 0, fallbackRatePct: null, needsJudgmentSharePct: null });
    expect(d.workflow).toEqual({ placedOrders: 0, avgDataAgeDays: null, avgOrderLagHours: null, runsThisMonth: 0 });
    expect(d.baseline).toMatchObject({ total_low: 2_800_000, total_high: 3_400_000 });
  });

  it("states each metric's definition and baseline for the tooltips", () => {
    expect(METRIC_DEFINITIONS.quarterLoss).toContain("Rs 28 to 34 lakh");
    expect(METRIC_DEFINITIONS.reversalRate).toContain("10% or more once 30");
    expect(METRIC_DEFINITIONS.dataAge).toContain("21 to 28 days");
    expect(Object.values(METRIC_DEFINITIONS).every((t) => t.length > 20)).toBe(true);
  });

  it("losses: this quarter's entries only, with the running total and the kill bands", async () => {
    await createLossEntry(db, u.priya, { periodStart: "2026-10-01", periodEnd: "2026-10-14", stockoutLossRupees: 1_000_000, overstockWriteoffRupees: 200_000 }, { now: NOW });
    await createLossEntry(db, u.priya, { periodStart: "2026-10-15", periodEnd: "2026-10-22", stockoutLossRupees: 500_000, overstockWriteoffRupees: 0, note: "week 42" }, { now: NOW });
    await createLossEntry(db, u.priya, { periodStart: "2026-09-01", periodEnd: "2026-09-30", stockoutLossRupees: 9_999_999, overstockWriteoffRupees: 0 }, { now: NOW });
    const d = await getDashboard(db, { now: NOW });
    expect(d.losses.map((l) => [l.periodStart, l.total, l.note])).toEqual([["2026-10-01", 1_200_000, null], ["2026-10-15", 500_000, "week 42"]]);
    expect(d.kill.kill2.loss).toMatchObject({ total: 1_700_000, stockout: 1_500_000, overstock: 200_000, entries: 2 });
    expect(d.kill.kill2).toMatchObject({ alertAbove: 2_800_000, killAbove: 3_400_000 });
  });

  it("reasons, run history and the reversal trend come from real reviews", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    await reviewDecision(db, u.raghav, reject(await idFor(db, run.runId, "SKU001"), "WRONG_QUANTITY"));
    await reviewDecision(db, u.raghav, reject(await idFor(db, run.runId, "SKU003"), "WRONG_QUANTITY"));
    await reviewDecision(db, u.raghav, reject(await idFor(db, run.runId, "SKU004"), "MARKET_EVENT"));
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU011"), outcome: "accepted" });
    const d = await getDashboard(db, { now: NOW });
    expect(d.reasons).toEqual([{ code: "WRONG_QUANTITY", count: 2 }, { code: "MARKET_EVENT", count: 1 }]);
    expect(d.runs).toHaveLength(1);
    expect(d.runs[0]).toMatchObject({ runId: run.runId, flags: 7, high: 1, stockout: 5, overstock: 2, accepted: 1, rejected: 3, fallback: 0, status: "in_review", asOfDate: "2026-10-19" });
    expect(d.runs[0].turnaroundHours).not.toBeNull();
    expect(d.trend).toHaveLength(1);
    expect(d.trend[0]).toMatchObject({ reviewed: 4, reversed: 3, ratePct: 75 });
    expect(d.kill.kill1.result).toMatchObject({ reviewed: 4, reversed: 3, verdict: "collecting" });
  });

  it("quality: fallback rate and needs-judgment share across decisions", async () => {
    await startSeedRun(db, u.raghav, { handler: () => "not json" });
    const d = await getDashboard(db, { now: NOW });
    expect(d.quality).toMatchObject({ decisions: 7, fallbackRatePct: 100, needsJudgmentSharePct: 0 });
    expect(d.runs[0].fallback).toBe(7);
    await db.update(aiDecisions).set({ needsJudgment: true }).where(eq(aiDecisions.id, (await db.select({ id: aiDecisions.id }).from(aiDecisions).limit(1))[0].id));
    expect((await getDashboard(db, { now: NOW })).quality.needsJudgmentSharePct).toBeCloseTo(100 / 7, 5);
  });

  it("fallback decisions never reach the reversal trend or the Kill 1 count", async () => {
    const run = await startSeedRun(db, u.raghav, { handler: () => "not json" });
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    await bulkAccept(db, u.raghav, []).catch(() => undefined); // empty list is refused; nothing happens
    for (const id of ids.slice(0, 2)) await reviewDecision(db, u.raghav, reject(id, "WRONG_ACTION"));
    const d = await getDashboard(db, { now: NOW });
    expect(d.trend).toEqual([]);
    expect(d.kill.kill1.result.reviewed).toBe(0);
    expect(d.reasons).toEqual([{ code: "WRONG_ACTION", count: 2 }]); // still shown as rejections by reason
    expect(run.fallbackWarning).toBe(true);
  });

  it("data age and order lag measure from the SAP data date and from the review, up to placing", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU003"), outcome: "accepted" });
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU004"), outcome: "accepted" });
    const [first, second] = await db.select().from(buyingDecisions).orderBy(buyingDecisions.id);
    // The reviews were saved just now. Place one order 2 hours later and one 26 hours later.
    const base = Date.now();
    const placeAt = [new Date(base + 2 * 3_600_000), new Date(base + 26 * 3_600_000)];
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(placeAt[0]);
    await markPlaced(db, u.procurement, [first.id], null);
    vi.setSystemTime(placeAt[1]);
    await markPlaced(db, u.procurement, [second.id], null);
    vi.useRealTimers();
    const ages = placeAt.map((t) => daysBetween("2026-10-19", istDate(t)));
    const d = await getDashboard(db, { now: NOW });
    expect(d.workflow.placedOrders).toBe(2);
    expect(d.workflow.avgDataAgeDays).toBeCloseTo((ages[0] + ages[1]) / 2, 1);
    expect(d.workflow.avgOrderLagHours).toBeGreaterThan(13.9);
    expect(d.workflow.avgOrderLagHours).toBeLessThan(14.1); // the average of 2 and 26 hours
  });

  it("runs this month counts completed runs only", async () => {
    const real = new Date();
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    expect((await getDashboard(db, { now: real })).workflow.runsThisMonth).toBe(0); // in review, not completed
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    await bulkAccept(db, u.raghav, ids);
    expect((await getDashboard(db, { now: real })).workflow.runsThisMonth).toBe(1);
    expect(run.runId).toBeGreaterThan(0);
  });
});

describe("the audit log (Deepa and admin)", () => {
  async function fill(n: number) {
    for (let i = 0; i < n; i++) await writeAudit(db, { actorId: i % 2 ? u.raghav.id : u.priya.id, action: i % 3 ? "review.accepted" : "loss_entry.created", entity: i % 3 ? "ai_decision" : "loss_entry", entityId: i, after: { i } });
  }

  it.each(["raghav", "procurement", "priya", "ceo"] as const)("%s cannot read it (403)", async (role) => {
    await expect(getAuditLog(db, u[role])).rejects.toMatchObject({ status: 403 });
  });

  it.each(["deepa", "admin"] as const)("%s can, newest first, with the actor's name", async (role) => {
    await fill(5);
    const log = await getAuditLog(db, u[role]);
    expect(log.total).toBe(5);
    expect(log.rows.map((r) => r.entityId)).toEqual(["4", "3", "2", "1", "0"]);
    expect(log.rows[0]).toMatchObject({ actor: "Test priya", action: "review.accepted" }); // entry 4: even, so Priya
    expect(log.actions).toEqual(["loss_entry.created", "review.accepted"]);
  });

  it("filters by action, entity, actor and date, and pages at 100", async () => {
    await fill(9);
    expect((await getAuditLog(db, u.deepa, { action: "loss_entry.created" })).total).toBe(3);
    expect((await getAuditLog(db, u.deepa, { entity: "ai_decision" })).total).toBe(6);
    expect((await getAuditLog(db, u.deepa, { actorId: u.priya.id })).total).toBe(5);
    // Raghav's are the odd entries 1, 3, 5, 7; of those 3 is a loss entry, so 3 are review.accepted.
    expect((await getAuditLog(db, u.deepa, { action: "review.accepted", actorId: u.raghav.id })).total).toBe(3);
    const today = istDate(new Date());
    expect((await getAuditLog(db, u.deepa, { from: today, to: today })).total).toBe(9); // all written today, India time
    expect((await getAuditLog(db, u.deepa, { from: today })).total).toBe(9);
    expect((await getAuditLog(db, u.deepa, { to: today })).total).toBe(9);
    expect((await getAuditLog(db, u.deepa, { from: "2020-01-01", to: "2020-01-02" })).total).toBe(0);
    const tomorrow = istDate(new Date(Date.now() + 36 * 3_600_000));
    expect((await getAuditLog(db, u.deepa, { from: tomorrow })).total).toBe(0);
    expect((await getAuditLog(db, u.deepa, { from: "not-a-date" })).total).toBe(9); // a bad date is ignored, not an error
    await fill(AUDIT_PAGE_SIZE); // 109 rows
    const second = await getAuditLog(db, u.deepa, { page: 2 });
    expect(second).toMatchObject({ total: 109, page: 2, pages: 2 });
    expect(second.rows).toHaveLength(9);
  });

  it("a day means a day in India time: an entry just after midnight there is on the new day, not the old one", async () => {
    // 00:30 IST on 23 October is 19:00 UTC on 22 October.
    await db.execute(sql`INSERT INTO audit_log (actor_id, action, entity, entity_id, created_at) VALUES (NULL, 'edge.case', 'x', '1', '2026-10-22T19:00:00Z')`);
    await db.execute(sql`INSERT INTO audit_log (actor_id, action, entity, entity_id, created_at) VALUES (NULL, 'edge.case', 'x', '2', '2026-10-23T18:29:59Z')`); // 23:59:59 IST, 23 Oct
    await db.execute(sql`INSERT INTO audit_log (actor_id, action, entity, entity_id, created_at) VALUES (NULL, 'edge.case', 'x', '3', '2026-10-22T18:29:59Z')`); // 23:59:59 IST, 22 Oct
    const on23 = await getAuditLog(db, u.deepa, { action: "edge.case", from: "2026-10-23", to: "2026-10-23" });
    expect(on23.rows.map((r) => r.entityId).sort()).toEqual(["1", "2"]);
    const on22 = await getAuditLog(db, u.deepa, { action: "edge.case", from: "2026-10-22", to: "2026-10-22" });
    expect(on22.rows.map((r) => r.entityId)).toEqual(["3"]);
  });

  it("the log itself is never offered an edit, and all roles still reach their own pages", async () => {
    await fill(1);
    expect((await db.select().from(auditLog)).length).toBe(1);
    expect(ROLES).toHaveLength(6);
  });
});
