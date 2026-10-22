import type { RulesConfig } from "@/lib/config/rules";
import { formatWeek, lastCompleteWeek, parseIsoDate, parseWeek, weekIndex } from "@/lib/dates/isoWeek";
import type { ValidatedData } from "@/lib/validation/types";
import { gt, lt, mean, roundHalfUp } from "./numeric";
import { FLAG_ORDER, type FlagRecord, type FlagType, type RunResult, type SkippedSku } from "./types";

/**
 * The deterministic rule engine (docs/02-BUSINESS-RULES.md). Data in, result out: no database, no clock,
 * no randomness, no model calls (guardrail G-R2). Every threshold comes from `rules` (G-R1).
 * Gemini never creates, removes or re-scores a flag; this function is the only source of flags.
 */
export function runRuleEngine(data: ValidatedData, rules: RulesConfig): RunResult {
  const cfg = rules.rules;
  if (cfg.combined_flag_multiplier_policy !== "highest") {
    throw new Error(`Unsupported combined_flag_multiplier_policy "${cfg.combined_flag_multiplier_policy}"`);
  }

  const asOf = parseIsoDate(data.asOfDate);
  if (!asOf) throw new Error(`Bad as-of date "${data.asOfDate}"`);
  const lastIdx = weekIndex(lastCompleteWeek(asOf));

  // Festival uplift: decided by the calendar month of the as-of date (open question 3).
  const month = data.calendar.find(
    (c) => c.year === asOf.getUTCFullYear() && c.month === asOf.getUTCMonth() + 1,
  );
  if (!month) throw new Error(`calendar has no row for ${data.asOfDate.slice(0, 7)}`);
  const uplift = month.is_festival ? 1 + cfg.festival_demand_uplift_pct / 100 : 1;

  // Units per SKU per week index, and stock per SKU (summed over locations, open question 28).
  const salesBySku = new Map<string, Map<number, number>>();
  for (const s of data.sales) {
    const parsed = parseWeek(s.week);
    if (!parsed) throw new Error(`Bad week "${s.week}"`);
    let weeks = salesBySku.get(s.sku_id);
    if (!weeks) salesBySku.set(s.sku_id, (weeks = new Map()));
    weeks.set(weekIndex(parsed), s.units_sold);
  }
  const stockBySku = new Map<string, number>();
  for (const i of data.inventory) stockBySku.set(i.sku_id, (stockBySku.get(i.sku_id) ?? 0) + i.units_on_hand);

  // Window of weeks (as indexes) for the recent average and the long average.
  const recentFrom = lastIdx - cfg.recent_window_weeks + 1;
  const avgTo = cfg.average_window_includes_recent ? lastIdx : lastIdx - cfg.recent_window_weeks;
  const avgFrom = avgTo - cfg.average_window_weeks + 1;
  const judgmentWindowFrom = lastIdx - cfg.average_window_weeks + 1; // "a zero-sales week in the last 12"

  const flags: FlagRecord[] = [];
  const unflagged: string[] = [];
  const skipped: SkippedSku[] = [];

  const skus = [...data.skus].sort((a, b) => (a.sku_id < b.sku_id ? -1 : a.sku_id > b.sku_id ? 1 : 0));
  for (const sku of skus) {
    const weeks = salesBySku.get(sku.sku_id);
    if (!weeks || weeks.size === 0) {
      skipped.push({ sku_id: sku.sku_id, reason: "No sales history (possible new launch). Not forecast." });
      continue;
    }
    const stock = stockBySku.get(sku.sku_id);
    if (stock === undefined) {
      skipped.push({ sku_id: sku.sku_id, reason: "No inventory row. Not forecast." });
      continue;
    }

    const recent = collect(weeks, recentFrom, lastIdx);
    const longRun = collect(weeks, avgFrom, avgTo);
    if (!recent || !longRun) {
      skipped.push({ sku_id: sku.sku_id, reason: "Sales history does not cover the averaging windows. Not forecast." });
      continue;
    }
    const recentAvg = mean(recent);
    const avgWeekly = mean(longRun);
    if (avgWeekly <= 0) {
      skipped.push({ sku_id: sku.sku_id, reason: "No sales in the averaging window, so demand cannot be measured. Not forecast." });
      continue;
    }

    const demandRate = avgWeekly * uplift;
    const cover = stock / demandRate;
    const ratio = recentAvg / avgWeekly;

    const perishable = cfg.perishable.applies_to_perishability.includes(sku.perishability);
    const minCover = perishable ? cfg.perishable.min_cover_weeks : cfg.stockout_cover_weeks;
    const maxCover = perishable ? cfg.perishable.max_cover_weeks : cfg.overstock_cover_weeks;

    const found = new Set<FlagType>();
    if (gt(ratio, 1 + cfg.high_demand_threshold_pct / 100)) found.add("HIGH_DEMAND");
    if (lt(cover, minCover)) found.add("STOCKOUT_RISK");
    if (gt(cover, maxCover)) found.add("OVERSTOCK_RISK");
    if (found.size === 0) {
      unflagged.push(sku.sku_id);
      continue;
    }
    const flagTypes = FLAG_ORDER.filter((f) => found.has(f));

    // Recommended action and quantity.
    let action: FlagRecord["rule_action"];
    let multiplier: number;
    if (found.has("OVERSTOCK_RISK")) {
      action = "PAUSE_ORDER"; // overstock, with or without high demand (the latter is a conflict, below)
      multiplier = 0;
    } else {
      action = "REORDER";
      const applicable: number[] = [];
      if (found.has("HIGH_DEMAND")) applicable.push(cfg.high_demand_reorder_multiplier);
      if (found.has("STOCKOUT_RISK")) applicable.push(cfg.stockout_reorder_multiplier);
      multiplier = Math.max(...applicable); // highest multiplier wins (open question 5)
    }
    const qty = action === "PAUSE_ORDER" ? 0 : roundHalfUp(multiplier * sku.standard_reorder_qty);

    // Needs judgment: proxies for the 15-20% the rules cannot cover (open question 14).
    const reasons: string[] = [];
    if (found.has("HIGH_DEMAND") && found.has("OVERSTOCK_RISK")) {
      reasons.push("Conflicting flags: high demand together with overstock risk.");
    }
    if (weeks.size < rules.data_guardrails.min_weeks_of_sales_required) {
      reasons.push(`Fewer than ${rules.data_guardrails.min_weeks_of_sales_required} weeks of sales history (${weeks.size}).`);
    }
    if (hasZeroWeek(weeks, judgmentWindowFrom, lastIdx)) {
      reasons.push(`A week with zero sales in the last ${cfg.average_window_weeks} weeks.`);
    }
    if (hasLargeSwing(recent, cfg.needs_judgment.week_on_week_swing_pct)) {
      reasons.push(
        `Sales swung by more than ${cfg.needs_judgment.week_on_week_swing_pct}% from one week to the next inside the last ${cfg.recent_window_weeks} weeks.`,
      );
    }

    flags.push({
      sku_id: sku.sku_id,
      flag_types: flagTypes,
      avg_weekly_sales: avgWeekly,
      recent_avg: recentAvg,
      demand_ratio: ratio,
      uplift,
      demand_rate: demandRate,
      units_on_hand: stock,
      cover_weeks: cover,
      min_cover: minCover,
      max_cover: maxCover,
      standard_qty: sku.standard_reorder_qty,
      multiplier,
      rule_action: action,
      rule_qty: qty,
      needs_judgment: reasons.length > 0,
      judgment_reasons: reasons,
    });
  }

  return {
    as_of_date: data.asOfDate,
    last_complete_week: formatWeek(lastCompleteWeek(asOf)),
    is_festival: month.is_festival,
    uplift,
    rules_version: rules.version,
    flags,
    unflagged,
    skipped,
  };
}

/** Units for each week index from `from` to `to` inclusive, or null if any week is missing. */
function collect(weeks: Map<number, number>, from: number, to: number): number[] | null {
  const out: number[] = [];
  for (let i = from; i <= to; i++) {
    const units = weeks.get(i);
    if (units === undefined) return null;
    out.push(units);
  }
  return out;
}

function hasZeroWeek(weeks: Map<number, number>, from: number, to: number): boolean {
  for (let i = from; i <= to; i++) if (weeks.get(i) === 0) return true;
  return false;
}

/** True if any week-on-week change inside the window is above the threshold (a rise from zero counts). */
function hasLargeSwing(window: number[], thresholdPct: number): boolean {
  for (let i = 1; i < window.length; i++) {
    const prev = window[i - 1];
    const change = Math.abs(window[i] - prev);
    if (prev === 0) {
      if (change > 0) return true;
    } else if (gt((change / prev) * 100, thresholdPct)) {
      return true;
    }
  }
  return false;
}
