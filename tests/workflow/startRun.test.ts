import { eq } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDecisions, flags, runs } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { getReviewData } from "@/lib/workflow/review";
import { loadSnapshotData } from "@/lib/workflow/runs";
import { fastRules } from "../helpers/ai";
import { replaceOnce, seedFiles } from "../helpers/seed";
import { count, createTestDb, resetRunData, seedTestUsers, startSeedRun, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));

describe("a stored run is reproducible and traceable", () => {
  it("stores the rules version, the full rules and the run context (G-R3)", async () => {
    const rules = fastRules();
    const run = await startSeedRun(db, u.raghav, { rules });
    const [row] = await db.select().from(runs).where(eq(runs.id, run.runId));
    expect(row.rulesVersion).toBe(rules.version);
    expect(row.rulesJson).toEqual(rules);
    expect(row.summaryJson).toMatchObject({
      as_of_date: "2026-10-19",
      last_complete_week: "2026-W42",
      is_festival: true,
      uplift: 1.25,
      unflagged: ["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"],
      skipped: [],
    });
  });

  it("stores the flags exactly as the rule engine computed them (G-A1: the AI adds none)", async () => {
    await startSeedRun(db, u.raghav);
    const rows = await db.select().from(flags).orderBy(flags.skuId);
    expect(rows.map((f) => [f.skuId, f.flagTypes, f.ruleAction, f.ruleQty])).toEqual([
      ["SKU001", ["HIGH_DEMAND", "STOCKOUT_RISK"], "REORDER", 750],
      ["SKU003", ["STOCKOUT_RISK"], "REORDER", 300],
      ["SKU004", ["STOCKOUT_RISK"], "REORDER", 150],
      ["SKU006", ["OVERSTOCK_RISK"], "PAUSE_ORDER", 0],
      ["SKU007", ["OVERSTOCK_RISK"], "PAUSE_ORDER", 0],
      ["SKU011", ["STOCKOUT_RISK"], "REORDER", 500],
      ["SKU013", ["STOCKOUT_RISK"], "REORDER", 120],
    ]);
    expect(rows[0].coverWeeks).toBeCloseTo(3.349, 2);
    expect(rows[0].demandRatio).toBeCloseTo(1.2144, 4);
  });

  it("stores each AI decision with model, prompt version, input and every attempt", async () => {
    await startSeedRun(db, u.raghav);
    const [d] = await db.select().from(aiDecisions).limit(1);
    expect(d).toMatchObject({ model: "mock-model", promptVersion: "flag-decision/1.0.0", valid: true, isFallback: false, status: "pending_review" });
    expect((d.inputJson as { sku: { sku_id: string } }).sku.sku_id).toMatch(/^SKU/);
    expect((d.attemptsJson as Array<{ outcome: string }>)[0].outcome).toBe("valid");
  });

  it("can rebuild the cleaned data from the stored raw files", async () => {
    const run = await startSeedRun(db, u.raghav);
    const { data } = await loadSnapshotData(db, run.snapshotId, fastRules());
    expect(data.asOfDate).toBe("2026-10-19");
    expect(data.sales).toHaveLength(240);
  });

  it("never goes stale: a run can be rebuilt from a snapshot long after the 7-day upload limit", async () => {
    const run = await startSeedRun(db, u.raghav);
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(new Date("2027-03-01T12:00:00+05:30"));
    try {
      const { data } = await loadSnapshotData(db, run.snapshotId, fastRules());
      expect(data.asOfDate).toBe("2026-10-19");
    } finally {
      vi.useRealTimers();
    }
  });

  it("an unknown snapshot is a 404", async () => {
    await expect(loadSnapshotData(db, 999, fastRules())).rejects.toMatchObject({ status: 404 });
  });
});

describe("blocked uploads leave nothing behind (G-D1)", () => {
  it("an error in any file blocks the run and writes no snapshot, run or audit entry", async () => {
    const files = seedFiles();
    files.sku_master = replaceOnce(files.sku_master, "Beverage,Low,500", "Beverage,Medium,500");
    await expect(startSeedRun(db, u.raghav, { files })).rejects.toMatchObject({ status: 422, code: "VALIDATION_FAILED" });
    for (const table of ["data_snapshots", "weekly_sales", "runs", "flags", "ai_decisions", "audit_log"]) {
      expect(await count(db, table)).toBe(0);
    }
  });

  it("only Raghav can start a run", async () => {
    for (const role of ["procurement", "priya", "deepa", "ceo", "admin"] as const) {
      await expect(startSeedRun(db, u[role])).rejects.toMatchObject({ status: 403 });
    }
    expect(await count(db, "runs")).toBe(0);
  });

  it("stale inventory blocks the run (7 days)", async () => {
    const { startRun } = await import("@/lib/workflow/startRun");
    const { aiRuntime } = await import("../helpers/workflow");
    await expect(
      startRun(db, u.raghav, { files: seedFiles(), acknowledgeWarnings: true, rules: fastRules(), ai: aiRuntime(), now: new Date("2026-10-30T12:00:00+05:30") }),
    ).rejects.toMatchObject({ code: "VALIDATION_FAILED" });
  });
});

describe("needs-judgment SKUs reach Raghav first", () => {
  it("a zero-sales week makes a flagged SKU needs-judgment, shown at the top of the review list", async () => {
    const files = seedFiles();
    files.sales = replaceOnce(files.sales, "SKU003,2026-W35,148", "SKU003,2026-W35,0");
    const run = await startSeedRun(db, u.raghav, { files, acknowledgeWarnings: true });
    expect(run.warnings).toBeGreaterThan(1); // the zero-sales week is a warning
    const data = await getReviewData(db, run.runId);
    expect(data.items[0]).toMatchObject({ skuId: "SKU003", needsJudgment: true });
    expect(data.items[0].judgmentReasons).toEqual(["A week with zero sales in the last 12 weeks."]);
    // The echo AI keeps needs_judgment true and the validator would refuse it lowering it.
    expect(data.items[0].isFallback).toBe(false);
  });

  it("an AI that tries to lower needs_judgment is refused and the fallback keeps it true", async () => {
    const files = seedFiles();
    files.sales = replaceOnce(files.sales, "SKU003,2026-W35,148", "SKU003,2026-W35,0");
    const lie = (req: { input: { sku: { sku_id: string }; needs_judgment_from_engine: boolean; rule_engine: { action: string; quantity: number } } }) =>
      JSON.stringify({
        sku_id: req.input.sku.sku_id,
        action: req.input.rule_engine.action,
        quantity: req.input.rule_engine.quantity,
        explanation: `Cover is low for ${req.input.sku.sku_id}, so the rule engine quantity is ordered as planned here.`,
        confidence: "HIGH",
        needs_judgment: false,
        judgment_note: null,
      });
    const run = await startSeedRun(db, u.raghav, { files, acknowledgeWarnings: true, handler: lie as never });
    const data = await getReviewData(db, run.runId);
    const sku003 = data.items.find((i) => i.skuId === "SKU003")!;
    expect(sku003).toMatchObject({ isFallback: true, needsJudgment: true });
    // Other SKUs, where the engine did not set it, are fine with needs_judgment false.
    expect(data.items.filter((i) => i.skuId !== "SKU003").every((i) => !i.isFallback)).toBe(true);
  });
});

describe("a run where the AI is down", () => {
  it("opens for review with every item a marked fallback and the run-level warning on", async () => {
    const run = await startSeedRun(db, u.raghav, { handler: () => { throw new Error("503"); } });
    expect(run).toMatchObject({ fallbackCount: 7, fallbackWarning: true });
    const data = await getReviewData(db, run.runId);
    expect(data.counts).toMatchObject({ total: 7, fallback: 7, pending: 7 });
    expect(data.run.fallbackWarning).toBe(true);
    expect(data.items.every((i) => i.isFallback && i.confidence === null)).toBe(true);
    // The fallback decision is the rule engine's own answer.
    expect(data.items.every((i) => i.action === i.ruleAction && i.quantity === i.ruleQty)).toBe(true);
  });
});
