import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { weekFromIndex, weekIndex, formatWeek, parseWeek } from "@/lib/dates/isoWeek";
import { runRuleEngine } from "@/lib/rules/engine";
import type { RunResult } from "@/lib/rules/types";
import type { ValidatedData } from "@/lib/validation/types";
import { NOW, seedFiles, validate, replaceOnce } from "./seed";

const LAST_WEEK = weekIndex(parseWeek("2026-W42")!);

export interface SynthSku {
  id?: string;
  perishability?: "Low" | "High";
  standardQty?: number;
  /** Weekly units, oldest to newest; the last value is week 2026-W42. */
  weekly: number[];
  onHand: number;
}

/** Builds validated-data for a run as of 2026-10-19 (last complete week 2026-W42). */
export function synth(skus: SynthSku[], opts: { festival?: boolean } = {}): ValidatedData {
  const data: ValidatedData = {
    asOfDate: "2026-10-19",
    lastCompleteWeek: "2026-W42",
    skus: [],
    distributors: [],
    calendar: [{ year: 2026, month: 10, is_festival: opts.festival ?? false }],
    sales: [],
    inventory: [],
    skusWithoutSales: [],
  };
  skus.forEach((s, n) => {
    const id = s.id ?? `SKU${String(n + 1).padStart(3, "0")}`;
    data.skus.push({
      sku_id: id,
      name: `Test ${id}`,
      category: "Test",
      perishability: s.perishability ?? "Low",
      standard_reorder_qty: s.standardQty ?? 100,
      uom: "Units",
      distributor_id: null,
    });
    s.weekly.forEach((units, i) => {
      const week = formatWeek(weekFromIndex(LAST_WEEK - (s.weekly.length - 1 - i)));
      data.sales.push({ sku_id: id, week, units_sold: units });
    });
    data.inventory.push({ sku_id: id, location: "Pune", units_on_hand: s.onHand, as_of_date: "2026-10-19" });
  });
  return data;
}

/** One SKU, run through the engine. Returns the single flag (or undefined) and the full result. */
export function runOne(
  sku: SynthSku,
  opts: { festival?: boolean; rules?: RulesConfig } = {},
): { flag: RunResult["flags"][number] | undefined; result: RunResult } {
  const result = runRuleEngine(synth([sku], opts), opts.rules ?? loadRules());
  return { flag: result.flags[0], result };
}

/** Eight older weeks, then four recent weeks. */
export function weeks(older: number, recent: number): number[] {
  return [...Array(8).fill(older), ...Array(4).fill(recent)];
}

export function flat(units = 100): number[] {
  return Array(12).fill(units);
}

/** The seed files through validation and the engine. `october` overrides the festival flag. */
export function runSeed(opts: { rules?: RulesConfig; octoberFestival?: boolean } = {}): RunResult {
  const files = seedFiles();
  if (opts.octoberFestival === false) {
    files.calendar = replaceOnce(files.calendar, "2026,10,2026-10,TRUE", "2026,10,2026-10,FALSE");
  }
  const rules = opts.rules ?? loadRules();
  const v = validate(files, { rules, now: NOW });
  if (!v.ok) throw new Error("seed did not validate: " + v.errors.map((e) => e.message).join("; "));
  return runRuleEngine(v.data!, rules);
}
