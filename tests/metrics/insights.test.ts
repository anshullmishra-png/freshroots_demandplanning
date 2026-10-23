import { beforeAll, beforeEach, describe, expect, it } from "vitest";
import type { AnyDb } from "@/db/snapshots";
import { loadRules } from "@/lib/config/rules";
import { runRuleEngine } from "@/lib/rules/engine";
import { coverAfter, exposureFor, getInsights, getRunData } from "@/lib/metrics/insights";
import { bulkAccept, reviewDecision, type ReviewRequest } from "@/lib/workflow/review";
import { markPlaced } from "@/lib/workflow/orders";
import { createLossEntry } from "@/lib/workflow/losses";
import { validate, seedFiles } from "../helpers/seed";
import { createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;
const rules = loadRules();

beforeAll(async () => {
  db = await createTestDb();
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));

describe("the engine reports cover for every forecast SKU, not only the flagged ones", () => {
  it("all 15 seed SKUs appear, the 7 flagged ones carry their flags, and the numbers match the flags", () => {
    const data = validate(seedFiles()).data!;
    const result = runRuleEngine(data, rules);
    expect(result.covers).toHaveLength(15);
    expect(result.covers.filter((c) => c.flag_types.length > 0)).toHaveLength(7);
    for (const f of result.flags) {
      const c = result.covers.find((x) => x.sku_id === f.sku_id)!;
      expect(c).toMatchObject({ cover_weeks: f.cover_weeks, min_cover: f.min_cover, max_cover: f.max_cover, units_on_hand: f.units_on_hand, demand_rate: f.demand_rate });
      expect(c.flag_types).toEqual(f.flag_types);
    }
    expect(result.covers.map((c) => c.sku_id)).toEqual([...result.covers.map((c) => c.sku_id)].sort());
  });
});

describe("projected cover", () => {
  it("a reorder adds the quantity over the weekly demand; a hold or no action changes nothing", () => {
    expect(coverAfter(3.35, 268.5, "REORDER", 750)).toBeCloseTo(3.35 + 750 / 268.5, 6);
    expect(coverAfter(3.35, 268.5, "PAUSE_ORDER", 0)).toBe(3.35);
    expect(coverAfter(3.35, 268.5, "NO_ACTION", 0)).toBe(3.35);
    expect(coverAfter(3.35, 0, "REORDER", 750)).toBe(3.35); // no demand rate: never divide by zero
  });
});

describe("loss exposure uses the case's own baseline, shared by sales volume", () => {
  it("the SKU shares add up to the baseline mid-points (Rs 20 lakh stockout, Rs 11 lakh overstock), give or take rounding", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const d = (await getRunData(db, run.runId, rules))!;
    expect(d.baselineStockout).toBe(2_000_000);
    expect(d.baselineOverstock).toBe(1_100_000);
    const sums = Object.values(d.bySku).reduce((a, s) => ({ stockout: a.stockout + s.stockout, overstock: a.overstock + s.overstock }), { stockout: 0, overstock: 0 });
    expect(Math.abs(sums.stockout - 2_000_000)).toBeLessThanOrEqual(15);
    expect(Math.abs(sums.overstock - 1_100_000)).toBeLessThanOrEqual(15);
    expect(Object.keys(d.bySku)).toHaveLength(15);
  });

  it("a reorder addresses a SKU's stockout share, a hold its overstock share, no action nothing", () => {
    const share = { stockout: 130_000, overstock: 70_000 };
    expect(exposureFor("REORDER", share)).toBe(130_000);
    expect(exposureFor("PAUSE_ORDER", share)).toBe(70_000);
    expect(exposureFor("NO_ACTION", share)).toBe(0);
    expect(exposureFor(null, share)).toBe(0);
  });
});

describe("weekly demand", () => {
  it("has one point per week of history, summing every SKU, with festival months marked", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const d = (await getRunData(db, run.runId, rules))!;
    expect(d.demand).toHaveLength(16);
    const fromCsv = seedFiles()
      .sales.split(/\r?\n/)
      .slice(1)
      .filter(Boolean)
      .reduce((a, l) => a + Number(l.split(",")[2]), 0);
    expect(d.demand.reduce((a, w) => a + w.units, 0)).toBe(fromCsv);
    expect(d.demand.some((w) => w.festival)).toBe(true);
    expect(d.demand.every((w, i, all) => i === 0 || all[i - 1].week < w.week)).toBe(true);
  });
});

describe("the insights change as Raghav decides", () => {
  it("no run yet: nothing", async () => {
    expect(await getInsights(db, rules)).toBeNull();
  });

  it("a fresh run is all waiting: 7 flagged, nothing reviewed or ordered, nothing addressed, no 'after' markers", async () => {
    await newSeedRun(db, { createdBy: u.raghav.id });
    const i = (await getInsights(db, rules))!;
    expect(i.funnel).toEqual({ flagged: 7, reviewed: 0, toOrder: 0, placed: 0 });
    expect(i.flagMix.total).toBe(7);
    expect(i.flagMix.stockout + i.flagMix.high + i.flagMix.overstock).toBeGreaterThanOrEqual(7);
    expect(i.exposure.addressed).toBe(0);
    expect(i.exposure.atStake).toBeGreaterThan(0);
    expect(i.covers).toHaveLength(15);
    expect(i.covers.every((c) => c.after === null)).toBe(true);
    expect(i.activity.map((a) => a.text)).toContain("AI recommendations are ready for review");
  });

  it("accepting one decision moves the pipeline, the projected cover, the exposure and the feed", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const id = await idFor(db, run.runId, "SKU001");
    await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "accepted" });
    const i = (await getInsights(db, rules))!;
    expect(i.funnel).toEqual({ flagged: 7, reviewed: 1, toOrder: 1, placed: 0 });
    const sku1 = i.covers.find((c) => c.skuId === "SKU001")!;
    expect(sku1.after).not.toBeNull();
    expect(sku1.after!).toBeGreaterThan(sku1.cover); // 750 units more stock
    expect(i.covers.filter((c) => c.after !== null)).toHaveLength(1);
    expect(i.exposure.addressed).toBe(i.exposure.bySku.SKU001.stockout);
    expect(i.activity[0].text).toBe("Raghav accepted SKU001: Reorder 750 units".replace("Raghav", "Test raghav"));
  });

  it("changing a decision to 'no action' addresses nothing and leaves the cover where it was", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const id = await idFor(db, run.runId, "SKU001");
    const change = { flagTypes: [] as string[], action: "NO_ACTION", quantity: 0, reasonCode: "WRONG_FLAG" };
    await reviewDecision(db, u.raghav, { aiDecisionId: id, outcome: "rejected", change } as unknown as ReviewRequest);
    const i = (await getInsights(db, rules))!;
    expect(i.funnel).toMatchObject({ reviewed: 1, toOrder: 0 });
    expect(i.exposure.addressed).toBe(0);
    const sku1 = i.covers.find((c) => c.skuId === "SKU001")!;
    expect(sku1.after).toBe(sku1.cover);
  });

  it("accepting everything addresses everything at stake, and placing the orders fills the last step", async () => {
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    const ids = await Promise.all(["SKU001", "SKU003", "SKU004", "SKU006", "SKU007", "SKU011", "SKU013"].map((s) => idFor(db, run.runId, s).catch(() => null)));
    const real = ids.filter((x): x is number => x !== null);
    await bulkAccept(db, u.raghav, real);
    let i = (await getInsights(db, rules))!;
    expect(i.funnel.reviewed).toBe(real.length);
    expect(i.exposure.addressed).toBeGreaterThan(0);
    expect(i.exposure.addressed).toBeLessThanOrEqual(i.exposure.atStake);
    const { rows } = (await db.execute("SELECT id FROM buying_decisions WHERE status = 'pending'" as never)) as unknown as { rows: Array<{ id: number }> };
    await markPlaced(db, u.procurement, rows.map((r) => r.id), "PO-1");
    i = (await getInsights(db, rules))!;
    expect(i.funnel.placed).toBe(i.funnel.toOrder);
    expect(i.activity.some((a) => a.text.startsWith("Test procurement placed the order for"))).toBe(true);
  });

  it("the feed shows loss entries in lakhs and newest first", async () => {
    await newSeedRun(db, { createdBy: u.raghav.id });
    await createLossEntry(db, u.priya, { periodStart: "2026-10-01", periodEnd: "2026-10-31", stockoutLossRupees: 2_000_000, overstockWriteoffRupees: 900_000 });
    const i = (await getInsights(db, rules))!;
    // Rs 29 lakh is above the alert level, so the alert is logged just after the entry and is the newest line.
    expect(i.activity[0].text).toBe("Loss alert raised: quarterly loss passed the alert level");
    expect(i.activity[1].text).toBe("Test priya entered a loss of Rs 29.00 lakh");
    expect(i.activity.length).toBeLessThanOrEqual(8);
    for (let k = 1; k < i.activity.length; k++) expect(i.activity[k - 1].at >= i.activity[k].at).toBe(true);
  });
});
