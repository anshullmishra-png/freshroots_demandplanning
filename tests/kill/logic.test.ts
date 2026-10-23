import { describe, expect, it } from "vitest";
import { loadRules } from "@/lib/config/rules";
import { evaluateKill1, evaluateKill2, formatLakhs, formatRupees, quarterOf } from "@/lib/kill/logic";
import { withRules } from "../helpers/seed";

const cfg1 = loadRules().kill_switch_1;
const cfg2 = loadRules().kill_switch_2;

describe("G. Kill 1: reversal monitor (min 30 reviewed, 10% or more, fallbacks already excluded)", () => {
  // The table from docs/10-TEST-PLAN.md, section G.
  it.each([
    [29, 10, "collecting"], // below the minimum sample: no kill even at 34%
    [30, 2, "ok"], // 6.7%
    [30, 3, "kill"], // exactly 10%
    [100, 9, "ok"],
    [100, 10, "kill"],
  ] as const)("%i reviewed, %i reversed -> %s", (reviewed, reversed, verdict) => {
    expect(evaluateKill1({ reviewed, reversed }, cfg1).verdict).toBe(verdict);
  });

  it("reports the rate and the thresholds it used", () => {
    expect(evaluateKill1({ reviewed: 30, reversed: 3 }, cfg1)).toMatchObject({ ratePct: 10, minReviewed: 30, thresholdPct: 10 });
    expect(evaluateKill1({ reviewed: 0, reversed: 0 }, cfg1)).toMatchObject({ verdict: "collecting", ratePct: null });
  });

  it("exactly 10% fires at other sample sizes too, and 9.99% does not", () => {
    expect(evaluateKill1({ reviewed: 50, reversed: 5 }, cfg1).verdict).toBe("kill");
    expect(evaluateKill1({ reviewed: 1000, reversed: 100 }, cfg1).verdict).toBe("kill");
    expect(evaluateKill1({ reviewed: 1000, reversed: 99 }, cfg1).verdict).toBe("ok");
    expect(evaluateKill1({ reviewed: 31, reversed: 3 }, cfg1).verdict).toBe("ok"); // 9.68%
    expect(evaluateKill1({ reviewed: 30, reversed: 30 }, cfg1).verdict).toBe("kill");
  });

  it("takes the minimum sample and the threshold from config", () => {
    const rules = withRules((c) => {
      c.kill_switch_1.min_reviewed_decisions = 10;
      c.kill_switch_1.reversal_rate_threshold_pct = 20;
    });
    expect(evaluateKill1({ reviewed: 10, reversed: 2 }, rules.kill_switch_1).verdict).toBe("kill");
    expect(evaluateKill1({ reviewed: 10, reversed: 1 }, rules.kill_switch_1).verdict).toBe("ok");
    expect(evaluateKill1({ reviewed: 9, reversed: 9 }, rules.kill_switch_1).verdict).toBe("collecting");
  });

  it("a strict operator in config makes exactly 10% safe", () => {
    const rules = withRules((c) => (c.kill_switch_1.operator = ">"));
    expect(evaluateKill1({ reviewed: 30, reversed: 3 }, rules.kill_switch_1).verdict).toBe("ok");
    expect(evaluateKill1({ reviewed: 30, reversed: 4 }, rules.kill_switch_1).verdict).toBe("kill");
  });

  it("a switch turned off in config never fires", () => {
    const rules = withRules((c) => (c.kill_switch_1.enabled = false));
    expect(evaluateKill1({ reviewed: 100, reversed: 100 }, rules.kill_switch_1).verdict).toBe("ok");
  });
});

describe("G. Kill 2: outcome gate (alert above Rs 28L, kill above Rs 34L, strictly)", () => {
  // The table from docs/10-TEST-PLAN.md, section G.
  it.each([
    [2_800_000, "green"],
    [2_800_001, "alert"],
    [3_400_000, "alert"],
    [3_400_001, "killed"],
  ] as const)("quarter-to-date loss Rs %i -> %s", (loss, band) => {
    expect(evaluateKill2(loss, cfg2)).toBe(band);
  });

  it("is exact to the paisa, so sums of decimals cannot move a boundary", () => {
    expect(evaluateKill2(2_800_000.0, cfg2)).toBe("green");
    expect(evaluateKill2(2_800_000.01, cfg2)).toBe("alert");
    expect(evaluateKill2(1_400_000.1 + 1_399_999.9, cfg2)).toBe("green"); // 28,00,000 in floating point drift
    expect(evaluateKill2(3_400_000.01, cfg2)).toBe("killed");
    expect(evaluateKill2(0, cfg2)).toBe("green");
  });

  it("takes both levels from config and respects the enabled flag", () => {
    const rules = withRules((c) => {
      c.kill_switch_2.alert_above_rupees = 100;
      c.kill_switch_2.kill_above_rupees = 200;
    });
    expect([evaluateKill2(100, rules.kill_switch_2), evaluateKill2(101, rules.kill_switch_2), evaluateKill2(201, rules.kill_switch_2)]).toEqual(["green", "alert", "killed"]);
    const off = withRules((c) => (c.kill_switch_2.enabled = false));
    expect(evaluateKill2(99_999_999, off.kill_switch_2)).toBe("green");
  });
});

describe("quarters", () => {
  it.each([
    ["2026-01-01", "2026-Q1", "2026-01-01", "2026-03-31"],
    ["2026-03-31", "2026-Q1", "2026-01-01", "2026-03-31"],
    ["2026-04-01", "2026-Q2", "2026-04-01", "2026-06-30"],
    ["2026-09-30", "2026-Q3", "2026-07-01", "2026-09-30"],
    ["2026-10-01", "2026-Q4", "2026-10-01", "2026-12-31"],
    ["2026-12-31", "2026-Q4", "2026-10-01", "2026-12-31"],
    ["2024-02-29", "2024-Q1", "2024-01-01", "2024-03-31"],
  ])("%s is in %s", (date, label, start, end) => {
    expect(quarterOf(date)).toEqual({ label, start, end });
  });

  it("a different start month shifts the quarters, including across a year end", () => {
    expect(quarterOf("2026-05-10", 4)).toMatchObject({ start: "2026-04-01", end: "2026-06-30" });
    expect(quarterOf("2026-02-10", 4)).toMatchObject({ start: "2026-01-01", end: "2026-03-31" });
    expect(quarterOf("2026-12-25", 11)).toMatchObject({ start: "2026-11-01", end: "2027-01-31" });
    expect(quarterOf("2027-01-05", 11)).toMatchObject({ start: "2026-11-01", end: "2027-01-31" });
  });

  it("rejects a bad date", () => {
    expect(() => quarterOf("26-10-01")).toThrow();
  });
});

describe("money formatting (stored in rupees, shown in lakhs)", () => {
  it("shows lakhs and Indian digit grouping", () => {
    expect(formatLakhs(2_800_000)).toBe("Rs 28.00 lakh");
    expect(formatLakhs(3_450_000)).toBe("Rs 34.50 lakh");
    expect(formatRupees(2_800_001)).toBe("Rs 28,00,001");
    expect(formatRupees(3_400_000)).toBe("Rs 34,00,000");
  });
});
