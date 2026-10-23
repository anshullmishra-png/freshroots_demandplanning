import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import { aiDecisions, auditLog, flags, killState, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { createMockClient, echoHandler } from "@/lib/ai/mock";
import { decideRun } from "@/lib/workflow/runs";
import { continueRun } from "@/lib/workflow/startRun";
import { reviewDecision } from "@/lib/workflow/review";
import { fastRules, prompts } from "../helpers/ai";
import { aiRuntime, count, createTestDb, newSeedRun, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));

// Two flags per batch, so the 7 flags of the seed run take 4 batches.
const rules = fastRules((c) => (c.ai.concurrency = 2));
const slow = (ms: number) => async (req: Parameters<typeof echoHandler>[0], i: number) => {
  await new Promise((r) => setTimeout(r, ms));
  return echoHandler(req, i);
};
const finish = (runId: number, client = createMockClient(echoHandler), budgetMs?: number) =>
  decideRun(db, { runId, rules, client, model: "mock-model", prompts, budgetMs });
const decisionsFor = async (runId: number) =>
  db.select({ flagId: aiDecisions.flagId }).from(aiDecisions).innerJoin(flags, eq(flags.id, aiDecisions.flagId)).where(eq(flags.runId, runId));

describe("the AI step saves its progress and can be resumed", () => {
  it("with no time left, the run and its flags are stored, no decisions are made, and it waits as 'flagged'", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    expect(run).toMatchObject({ flagCount: 7, remaining: 7, status: "flagged", fallbackCount: 0 });
    expect(await count(db, "flags")).toBe(7);
    expect(await count(db, "ai_decisions")).toBe(0);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "run.ai_done")))).toHaveLength(0);
  });

  it("carrying on finishes it: 7 decisions, open for review, and the completion is audited once", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    const done = await finish(run.runId);
    expect(done).toMatchObject({ remaining: 0, status: "in_review", flagCount: 7, fallbackWarning: false });
    expect(await count(db, "ai_decisions")).toBe(7);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "run.ai_done"))).toHaveLength(1);
  });

  it("makes progress within the budget, then resumes with no repeated work", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    const client = createMockClient(slow(40));
    // Each batch of two takes about 40 ms. A budget of 60 ms allows a batch or two, not all four.
    let state = await finish(run.runId, client, 60);
    expect(state.remaining).toBeGreaterThan(0);
    expect(state.remaining).toBeLessThan(7);
    expect(state.status).toBe("flagged");
    const partial = (await decisionsFor(run.runId)).length;
    expect(partial).toBe(7 - state.remaining);
    for (let i = 0; i < 10 && state.remaining > 0; i++) state = await finish(run.runId, client, 60);
    expect(state).toMatchObject({ remaining: 0, status: "in_review" });
    const all = await decisionsFor(run.runId);
    expect(new Set(all.map((d) => d.flagId)).size).toBe(7); // one decision per flag
    expect(client.calls).toHaveLength(7); // each flag went to the model exactly once
  });

  it("two requests carrying on at the same moment still leave one decision per flag and one completion", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    await Promise.all([finish(run.runId), finish(run.runId)]);
    expect((await decisionsFor(run.runId)).length).toBe(7);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "run.ai_done"))).toHaveLength(1);
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].status).toBe("in_review");
  });

  it("a run that is already open for review is left alone: no AI calls", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules });
    const client = createMockClient(echoHandler);
    expect(await finish(run.runId, client)).toMatchObject({ remaining: 0, status: "in_review" });
    expect(client.calls).toHaveLength(0);
  });

  it("an unknown run is a 404", async () => {
    await expect(finish(9999)).rejects.toMatchObject({ status: 404 });
  });

  it("a run with no flags is completed at once", async () => {
    const quiet = fastRules((c) => {
      c.rules.stockout_cover_weeks = 0;
      c.rules.overstock_cover_weeks = 1_000_000;
      c.rules.perishable.min_cover_weeks = 0;
      c.rules.perishable.max_cover_weeks = 1_000_000;
      c.rules.high_demand_threshold_pct = 10_000;
    });
    expect(await newSeedRun(db, { createdBy: u.raghav.id, rules: quiet })).toMatchObject({ flagCount: 0, remaining: 0, status: "completed" });
  });
});

describe("the fallback warning counts the whole run, not one batch", () => {
  it("when the AI fails on every flag across all batches, the warning is on once the run is open", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    const done = await finish(run.runId, createMockClient(() => "not json"));
    expect(done).toMatchObject({ remaining: 0, fallbackCount: 7, fallbackWarning: true, status: "in_review" });
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].fallbackWarning).toBe(true);
  });

  it("2 of 7 failing (28.6%) is below the line, even when the failures land in different batches", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    // The model keeps failing for two chosen SKUs (retries included); every other SKU is answered.
    const bad = new Set<string>();
    const done = await finish(
      run.runId,
      createMockClient((req, i) => {
        const sku = req.input.sku.sku_id;
        if (bad.size < 2) bad.add(sku);
        return bad.has(sku) ? "garbage" : echoHandler(req, i);
      }),
    );
    expect(done).toMatchObject({ fallbackCount: 2, fallbackWarning: false, remaining: 0 });
  });
});

describe("a stopped system makes no more AI decisions", () => {
  it("carrying on is refused while a kill is active, and nothing is written", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    await db.update(killState).set({ kill2State: "killed" }).where(eq(killState.id, 1));
    const client = createMockClient(echoHandler);
    await expect(finish(run.runId, client)).rejects.toMatchObject({ status: 409, code: "AUTOMATION_STOPPED" });
    expect(client.calls).toHaveLength(0);
    expect(await count(db, "ai_decisions")).toBe(0);
  });
});

describe("reviewing while decisions are still arriving", () => {
  it("decisions made so far can be reviewed, but the run is not 'completed' early", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    const client = createMockClient(slow(30));
    let state = await finish(run.runId, client, 40);
    expect(state.remaining).toBeGreaterThan(0);
    const early = await db.select({ id: aiDecisions.id }).from(aiDecisions);
    for (const d of early) await reviewDecision(db, u.raghav, { aiDecisionId: d.id, outcome: "accepted" });
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].status).toBe("flagged"); // not completed: more are coming
    for (let i = 0; i < 10 && state.remaining > 0; i++) state = await finish(run.runId, client, 40);
    expect(state.remaining).toBe(0);
    // Some are already reviewed and some are new: the run opens for review, with the new ones pending.
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].status).toBe("in_review");
    expect(await count(db, "reviews")).toBe(early.length);
  });

  it("if everything was reviewed before the last decisions arrived and nothing is left pending, the run completes", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    await finish(run.runId, createMockClient(echoHandler), 0);
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].status).toBe("flagged");
    await finish(run.runId);
    const ids = (await db.select({ id: aiDecisions.id }).from(aiDecisions)).map((r) => r.id);
    for (const id of ids) await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" });
    expect((await db.select().from(runs).where(eq(runs.id, run.runId)))[0].status).toBe("completed");
  });
});

describe("starting and continuing a run through the service", () => {
  it("start run with no time left says how many decisions remain; continue finishes it", async () => {
    const started = await startSeedRun(db, u.raghav, { rules, budgetMs: 0 });
    expect(started).toMatchObject({ flagCount: 7, remaining: 7, status: "flagged" });
    const done = await continueRun(db, u.raghav, started.runId, { rules, ai: aiRuntime() });
    expect(done).toMatchObject({ remaining: 0, status: "in_review" });
  });

  it.each(["procurement", "priya", "deepa", "ceo", "admin"] as const)("%s cannot continue a run (403)", async (role) => {
    const started = await startSeedRun(db, u.raghav, { rules, budgetMs: 0 });
    await expect(continueRun(db, u[role], started.runId, { rules, ai: aiRuntime() })).rejects.toMatchObject({ status: 403 });
    expect(await count(db, "ai_decisions")).toBe(0);
  });

  it("the stored flags carry everything the AI input needs, so a resumed run asks the model the same question", async () => {
    const whole = createMockClient(echoHandler);
    await newSeedRun(db, { createdBy: u.raghav.id, rules, client: whole });
    const asked = whole.calls.map((c) => JSON.stringify(c.input)).sort();
    await resetRunData(db);
    const resumed = createMockClient(echoHandler);
    const run = await newSeedRun(db, { createdBy: u.raghav.id, rules, budgetMs: 0 });
    await finish(run.runId, resumed);
    expect(resumed.calls.map((c) => JSON.stringify(c.input)).sort()).toEqual(asked);
  });
});
