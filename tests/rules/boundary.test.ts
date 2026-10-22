import { describe, expect, it } from "vitest";
import { loadRules } from "@/lib/config/rules";
import { runRuleEngine } from "@/lib/rules/engine";
import { withRules } from "../helpers/seed";
import { flat, runOne, runSeed, synth, weeks } from "../helpers/synth";

const flags = (r: ReturnType<typeof runOne>) => r.flag?.flag_types ?? [];

describe("C. boundaries: demand ratio (strictly greater than 1.20)", () => {
  // recent avg 100, older 75: long avg 83.33, ratio exactly 1.2 (floating point gives 1.2000000000000002)
  it("exactly 1.20 is not high demand", () => {
    const r = runOne({ weekly: weeks(75, 100), onHand: 800 });
    expect(flags(r)).toEqual([]);
    expect(r.result.unflagged).toEqual(["SKU001"]);
  });

  it("1.2001 is high demand", () => {
    const r = runOne({ weekly: weeks(7499, 10000), onHand: 80000 });
    expect(r.flag!.demand_ratio).toBeGreaterThan(1.2);
    expect(r.flag!.demand_ratio).toBeLessThan(1.2002);
    expect(flags(r)).toEqual(["HIGH_DEMAND"]);
  });

  it("a clearly higher ratio is high demand", () => {
    expect(flags(runOne({ weekly: weeks(749, 1000), onHand: 8000 }))).toEqual(["HIGH_DEMAND"]);
  });
});

describe("C. boundaries: cover weeks, normal SKU (6 and 14, strict)", () => {
  it.each([
    [600, []],
    [599, ["STOCKOUT_RISK"]],
    [1400, []],
    [1401, ["OVERSTOCK_RISK"]],
  ])("on hand %i of 100/week", (onHand, expected) => {
    expect(flags(runOne({ weekly: flat(), onHand }))).toEqual(expected);
  });
});

describe("C. boundaries: cover weeks, perishable SKU (3 and 4, replacing 6 and 14)", () => {
  it.each([
    [300, []],
    [299, ["STOCKOUT_RISK"]],
    [400, []],
    [401, ["OVERSTOCK_RISK"]],
    [500, ["OVERSTOCK_RISK"]], // 5 weeks is fine for a normal SKU but over the 4-week perishable max
  ])("on hand %i of 100/week", (onHand, expected) => {
    expect(flags(runOne({ perishability: "High", weekly: flat(), onHand }))).toEqual(expected);
  });

  it("the same 5 weeks of stock is unflagged for a normal SKU", () => {
    expect(flags(runOne({ weekly: flat(), onHand: 500 }))).toEqual(["STOCKOUT_RISK"]); // below 6
    expect(flags(runOne({ weekly: flat(), onHand: 700 }))).toEqual([]);
  });
});

describe("C. boundaries: festival uplift is applied before the cover checks", () => {
  it.each([
    [750, []], // demand rate 125, cover exactly 6.0
    [749, ["STOCKOUT_RISK"]],
  ])("festival month, on hand %i of 100/week", (onHand, expected) => {
    expect(flags(runOne({ weekly: flat(), onHand }, { festival: true }))).toEqual(expected);
  });

  it("the same 749 units is flagged in a festival month but fine outside one (7.49 weeks of cover)", () => {
    expect(flags(runOne({ weekly: flat(), onHand: 749 }, { festival: true }))).toEqual(["STOCKOUT_RISK"]);
    expect(flags(runOne({ weekly: flat(), onHand: 749 }, { festival: false }))).toEqual([]);
  });
});

describe("C. action and quantity", () => {
  it("stockout only: reorder 1.0x the standard quantity", () => {
    const f = runOne({ weekly: flat(), onHand: 100, standardQty: 200 }).flag!;
    expect([f.rule_action, f.multiplier, f.rule_qty]).toEqual(["REORDER", 1, 200]);
  });

  it("high demand only: reorder 1.5x", () => {
    const f = runOne({ weekly: weeks(100, 140), onHand: 1100, standardQty: 200 }).flag!;
    expect(f.flag_types).toEqual(["HIGH_DEMAND"]);
    expect([f.rule_action, f.multiplier, f.rule_qty]).toEqual(["REORDER", 1.5, 300]);
  });

  it("high demand with stockout: the highest multiplier wins (1.5x, not 1.0x)", () => {
    const f = runOne({ weekly: weeks(100, 140), onHand: 100, standardQty: 200 }).flag!;
    expect(f.flag_types).toEqual(["HIGH_DEMAND", "STOCKOUT_RISK"]);
    expect(f.rule_qty).toBe(300);
  });

  it("rounds to whole units: 1.5 x 150 = 225, and half a unit rounds up (1.5 x 75 = 112.5 becomes 113)", () => {
    expect(runOne({ weekly: weeks(100, 140), onHand: 100, standardQty: 150 }).flag!.rule_qty).toBe(225);
    expect(runOne({ weekly: weeks(100, 140), onHand: 100, standardQty: 75 }).flag!.rule_qty).toBe(113);
  });

  it("overstock only: pause the order, quantity 0", () => {
    const f = runOne({ weekly: flat(), onHand: 2000 }).flag!;
    expect([f.rule_action, f.rule_qty, f.needs_judgment]).toEqual(["PAUSE_ORDER", 0, false]);
  });

  it("high demand with overstock: both flags, pause, quantity 0, needs judgment", () => {
    const f = runOne({ weekly: weeks(100, 150), onHand: 2000 }).flag!;
    expect(f.flag_types).toEqual(["HIGH_DEMAND", "OVERSTOCK_RISK"]);
    expect([f.rule_action, f.rule_qty, f.multiplier]).toEqual(["PAUSE_ORDER", 0, 0]);
    expect(f.needs_judgment).toBe(true);
    expect(f.judgment_reasons).toEqual(["Conflicting flags: high demand together with overstock risk."]);
  });

  it("stockout and overstock never appear together", () => {
    for (const onHand of [0, 100, 600, 1000, 1400, 5000]) {
      const f = runOne({ weekly: flat(), onHand }).flag;
      expect(f?.flag_types.includes("STOCKOUT_RISK") && f?.flag_types.includes("OVERSTOCK_RISK")).toBeFalsy();
    }
  });
});

describe("C. needs-judgment proxies", () => {
  const lowStock = 100; // cover 1 week: always flagged, so the reasons are visible

  it("a zero-sales week inside the last 12 weeks", () => {
    const weekly = flat();
    weekly[3] = 0;
    const f = runOne({ weekly, onHand: lowStock }).flag!;
    expect(f.needs_judgment).toBe(true);
    expect(f.judgment_reasons).toEqual(["A week with zero sales in the last 12 weeks."]);
  });

  it("a zero-sales week older than 12 weeks is ignored", () => {
    const f = runOne({ weekly: [0, ...Array(13).fill(100)], onHand: lowStock }).flag!;
    expect(f.needs_judgment).toBe(false);
  });

  it("a week-on-week swing above 50% inside the last 4 weeks", () => {
    const f = runOne({ weekly: [...Array(11).fill(100), 160], onHand: lowStock }).flag!;
    expect(f.needs_judgment).toBe(true);
    expect(f.judgment_reasons[0]).toContain("more than 50%");
  });

  it("exactly 50% is not a swing (strictly greater)", () => {
    expect(runOne({ weekly: [...Array(11).fill(100), 150], onHand: lowStock }).flag!.needs_judgment).toBe(false);
  });

  it("a swing between older weeks is ignored", () => {
    const weekly = flat();
    weekly[2] = 300; // week 3 of 12 is outside the last 4
    expect(runOne({ weekly, onHand: lowStock }).flag!.needs_judgment).toBe(false);
  });

  it("fewer weeks of history than the configured minimum", () => {
    const rules = withRules((c) => (c.data_guardrails.min_weeks_of_sales_required = 13));
    const f = runOne({ weekly: flat(), onHand: lowStock }, { rules }).flag!;
    expect(f.judgment_reasons).toEqual(["Fewer than 13 weeks of sales history (12)."]);
  });

  it("takes the swing threshold from config", () => {
    const rules = withRules((c) => (c.rules.needs_judgment.week_on_week_swing_pct = 70));
    expect(runOne({ weekly: [...Array(11).fill(100), 160], onHand: lowStock }, { rules }).flag!.needs_judgment).toBe(false);
  });
});

describe("C. SKUs that cannot be forecast are skipped, never guessed", () => {
  it("a SKU in the master with no sales", () => {
    const data = synth([{ weekly: flat(), onHand: 100 }]);
    data.skus.push({ ...data.skus[0], sku_id: "SKU900" });
    data.inventory.push({ sku_id: "SKU900", location: "Pune", units_on_hand: 10, as_of_date: "2026-10-19" });
    const r = runRuleEngine(data, loadRules());
    expect(r.skipped.map((s) => s.sku_id)).toEqual(["SKU900"]);
    expect(r.flags.map((f) => f.sku_id)).toEqual(["SKU001"]);
  });

  it("a SKU whose sales in the window are all zero (demand cannot be measured)", () => {
    const r = runOne({ weekly: flat(0), onHand: 100 });
    expect(r.flag).toBeUndefined();
    expect(r.result.skipped).toHaveLength(1);
    expect(r.result.skipped[0].reason).toContain("No sales in the averaging window");
  });
});

describe("C. stock is summed across locations (open question 28)", () => {
  it("two locations of 300 count as 600, exactly 6 weeks of cover", () => {
    const data = synth([{ weekly: flat(), onHand: 300 }]);
    data.inventory.push({ sku_id: "SKU001", location: "Mumbai", units_on_hand: 300, as_of_date: "2026-10-19" });
    const r = runRuleEngine(data, loadRules());
    expect(r.flags).toEqual([]);
    const single = runOne({ weekly: flat(), onHand: 300 }).flag!;
    expect(single.flag_types).toEqual(["STOCKOUT_RISK"]);
  });
});

describe("C. determinism and config", () => {
  it("two runs on the same input give byte-identical output", () => {
    expect(JSON.stringify(runSeed())).toBe(JSON.stringify(runSeed()));
  });

  it("the order of the input rows does not change the output", () => {
    const rules = loadRules();
    const data = synth([
      { weekly: flat(), onHand: 100 },
      { weekly: weeks(100, 150), onHand: 2000 },
      { perishability: "High", weekly: flat(), onHand: 500 },
    ]);
    const shuffled = { ...data, skus: [...data.skus].reverse(), sales: [...data.sales].reverse(), inventory: [...data.inventory].reverse() };
    expect(JSON.stringify(runRuleEngine(shuffled, rules))).toBe(JSON.stringify(runRuleEngine(data, rules)));
  });

  it("changing stockout_cover_weeks in config changes the flags with no code change", () => {
    const sku = { weekly: flat(), onHand: 700 }; // 7 weeks of cover
    expect(flags(runOne(sku))).toEqual([]);
    const rules = withRules((c) => (c.rules.stockout_cover_weeks = 8));
    expect(flags(runOne(sku, { rules }))).toEqual(["STOCKOUT_RISK"]);
  });

  it("the multipliers and the high-demand threshold come from config", () => {
    const rules = withRules((c) => {
      c.rules.high_demand_reorder_multiplier = 2;
      c.rules.high_demand_threshold_pct = 30;
    });
    // ratio 1.235 is above 20% but not above 30%
    expect(flags(runOne({ weekly: weeks(100, 140), onHand: 1100 }, { rules }))).toEqual([]);
    const f = runOne({ weekly: weeks(100, 200), onHand: 1500, standardQty: 100 }, { rules }).flag!;
    expect(f.rule_qty).toBe(200);
  });

  it("the perishable band comes from config", () => {
    const rules = withRules((c) => (c.rules.perishable.max_cover_weeks = 6));
    expect(flags(runOne({ perishability: "High", weekly: flat(), onHand: 500 }, { rules }))).toEqual([]);
  });
});

describe("I. performance", () => {
  it("400 SKUs with 52 weeks of history run in well under 5 seconds", () => {
    let seed = 42;
    const rand = () => ((seed = (seed * 1664525 + 1013904223) % 4294967296) / 4294967296);
    const skus = Array.from({ length: 400 }, (_, i) => {
      const base = 20 + Math.floor(rand() * 280);
      return {
        id: `SKU${String(i + 1).padStart(3, "0")}`,
        perishability: (rand() < 0.2 ? "High" : "Low") as "High" | "Low",
        standardQty: 50 + Math.floor(rand() * 450),
        weekly: Array.from({ length: 52 }, () => Math.max(1, Math.round(base * (0.8 + rand() * 0.5)))),
        onHand: Math.floor(base * rand() * 20),
      };
    });
    const data = synth(skus, { festival: true });
    expect(data.sales).toHaveLength(400 * 52);
    const rules = loadRules();
    const started = performance.now();
    const result = runRuleEngine(data, rules);
    const ms = performance.now() - started;
    expect(result.flags.length + result.unflagged.length + result.skipped.length).toBe(400);
    expect(result.flags.length).toBeGreaterThan(0);
    expect(ms).toBeLessThan(5000);
  });
});
