import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import path from "node:path";

const rules = JSON.parse(
  readFileSync(path.resolve(__dirname, "../config/rules.json"), "utf8"),
);

describe("config/rules.json", () => {
  it("carries the thresholds from the approved docs", () => {
    expect(rules.rules.recent_window_weeks).toBe(4);
    expect(rules.rules.average_window_weeks).toBe(12);
    expect(rules.rules.high_demand_threshold_pct).toBe(20);
    expect(rules.rules.high_demand_reorder_multiplier).toBe(1.5);
    expect(rules.rules.stockout_cover_weeks).toBe(6);
    expect(rules.rules.overstock_cover_weeks).toBe(14);
    expect(rules.rules.festival_demand_uplift_pct).toBe(25);
    expect(rules.rules.perishable.min_cover_weeks).toBe(3);
    expect(rules.rules.perishable.max_cover_weeks).toBe(4);
  });

  it("carries the kill-switch thresholds", () => {
    expect(rules.kill_switch_1.min_reviewed_decisions).toBe(30);
    expect(rules.kill_switch_1.reversal_rate_threshold_pct).toBe(10);
    expect(rules.kill_switch_2.alert_above_rupees).toBe(2_800_000);
    expect(rules.kill_switch_2.kill_above_rupees).toBe(3_400_000);
  });

  it("ships with the safe AI default (AI must match the rule engine)", () => {
    expect(rules.ai.deviation_policy).toBe("none");
  });
});
