import { describe, expect, it } from "vitest";
import { runSeed } from "../helpers/synth";
import { withRules } from "../helpers/seed";

const round = (n: number, dp: number) => Number(n.toFixed(dp));

describe("A. golden test: seed data, default config (docs/10-TEST-PLAN.md)", () => {
  const result = runSeed();
  const byId = Object.fromEntries(result.flags.map((f) => [f.sku_id, f]));

  it("reads the run context from the data", () => {
    expect(result.as_of_date).toBe("2026-10-19");
    expect(result.last_complete_week).toBe("2026-W42");
    expect(result.is_festival).toBe(true);
    expect(result.uplift).toBe(1.25);
  });

  it("flags exactly the 7 expected SKUs, with cover weeks, action and quantity", () => {
    const table = result.flags.map((f) => [f.sku_id, f.flag_types, round(f.cover_weeks, 2), f.rule_action, f.rule_qty]);
    expect(table).toEqual([
      ["SKU001", ["HIGH_DEMAND", "STOCKOUT_RISK"], 3.35, "REORDER", 750],
      ["SKU003", ["STOCKOUT_RISK"], 4.36, "REORDER", 300],
      ["SKU004", ["STOCKOUT_RISK"], 1.8, "REORDER", 150],
      ["SKU006", ["OVERSTOCK_RISK"], 22.23, "PAUSE_ORDER", 0],
      ["SKU007", ["OVERSTOCK_RISK"], 4.08, "PAUSE_ORDER", 0],
      ["SKU011", ["STOCKOUT_RISK"], 1.8, "REORDER", 500],
      ["SKU013", ["STOCKOUT_RISK"], 3.17, "REORDER", 120],
    ]);
  });

  it("leaves the other 8 SKUs unflagged", () => {
    expect(result.unflagged).toEqual(["SKU002", "SKU005", "SKU008", "SKU009", "SKU010", "SKU012", "SKU014", "SKU015"]);
    expect(result.skipped).toEqual([]);
  });

  it("computes SKU001's averages and ratio as in the worked example", () => {
    const f = byId.SKU001;
    expect(round(f.avg_weekly_sales, 2)).toBe(214.92); // W31-W42
    expect(round(f.recent_avg, 2)).toBe(261.0); // W39-W42
    expect(round(f.demand_ratio, 4)).toBe(1.2144);
    expect(round(f.demand_rate, 2)).toBe(268.65);
    expect(f.multiplier).toBe(1.5);
    expect(f.standard_qty).toBe(500);
  });

  it("uses the perishable band (3 to 4 weeks) for High-perishability SKUs and 6 to 14 for the rest", () => {
    expect([byId.SKU004.min_cover, byId.SKU004.max_cover]).toEqual([3, 4]);
    expect([byId.SKU007.min_cover, byId.SKU007.max_cover]).toEqual([3, 4]);
    expect([byId.SKU011.min_cover, byId.SKU011.max_cover]).toEqual([3, 4]);
    expect([byId.SKU001.min_cover, byId.SKU001.max_cover]).toEqual([6, 14]);
  });

  it("protects the two boundary cases: SKU001 ratio just over 1.20 and SKU007 cover just over 4", () => {
    expect(byId.SKU001.flag_types).toContain("HIGH_DEMAND");
    expect(byId.SKU007.flag_types).toEqual(["OVERSTOCK_RISK"]);
  });

  it("raises no needs-judgment on the seed", () => {
    expect(result.flags.every((f) => !f.needs_judgment && f.judgment_reasons.length === 0)).toBe(true);
  });

  it("stamps the rules version", () => {
    expect(result.rules_version).toBe("1.2.0");
  });
});

describe("B. variant: festival uplift off (October marked non-festival)", () => {
  const result = runSeed({ octoberFestival: false });

  it("applies no uplift, so the flags and cover weeks change as in the test plan", () => {
    expect(result.is_festival).toBe(false);
    expect(result.uplift).toBe(1);
    const table = result.flags.map((f) => [f.sku_id, f.flag_types, round(f.cover_weeks, 1)]);
    expect(table).toEqual([
      ["SKU001", ["HIGH_DEMAND", "STOCKOUT_RISK"], 4.2],
      ["SKU002", ["OVERSTOCK_RISK"], 14.3],
      ["SKU003", ["STOCKOUT_RISK"], 5.4],
      ["SKU004", ["STOCKOUT_RISK"], 2.3],
      ["SKU006", ["OVERSTOCK_RISK"], 27.8],
      ["SKU007", ["OVERSTOCK_RISK"], 5.1],
      ["SKU011", ["STOCKOUT_RISK"], 2.3],
      ["SKU013", ["STOCKOUT_RISK"], 4.0],
    ]);
  });

  it("does not change the demand ratio (the uplift cancels)", () => {
    const base = Object.fromEntries(runSeed().flags.map((f) => [f.sku_id, f.demand_ratio]));
    const f = result.flags.find((x) => x.sku_id === "SKU001")!;
    expect(f.demand_ratio).toBe(base.SKU001);
  });
});

describe("open-question defaults stay switchable by config", () => {
  it("Q2: the 12-week average can exclude the last 4 weeks", () => {
    const rules = withRules((c) => (c.rules.average_window_includes_recent = false));
    const result = runSeed({ rules });
    // W27-W38 for SKU001: (194+188+204+186+201+195+185+200+185+197+186+186) / 12
    const sku001 = result.flags.find((f) => f.sku_id === "SKU001")!;
    expect(sku001.avg_weekly_sales).toBeCloseTo(2307 / 12, 10);
    expect(sku001.recent_avg).toBe(261); // the recent window is unchanged
  });

  it("Q3: the uplift size comes from config", () => {
    const rules = withRules((c) => (c.rules.festival_demand_uplift_pct = 0));
    const result = runSeed({ rules });
    expect(result.uplift).toBe(1);
    expect(result.flags.map((f) => f.sku_id)).toContain("SKU002");
  });
});
