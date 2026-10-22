import type { RulesConfig } from "@/lib/config/rules";
import type { FlagRecord } from "@/lib/rules/types";
import type { SkuRow } from "@/lib/validation/types";
import type { AiInput } from "./types";

const round = (n: number, dp: number) => Number(n.toFixed(dp));

/**
 * Builds the model input for one flagged SKU. Numbers are rounded once, here, to the precision shown
 * in docs/04-AI-SPEC.md; the validator later compares the explanation against these exact values.
 */
export function buildAiInput(
  flag: FlagRecord,
  sku: SkuRow,
  run: { as_of_date: string; is_festival: boolean },
  rules: RulesConfig,
): AiInput {
  const qty = flag.rule_qty;
  let limits = { min: qty, max: qty };
  if (rules.ai.deviation_policy === "bounded" && flag.rule_action === "REORDER") {
    const pct = rules.ai.bounded_deviation_pct / 100;
    // Stay inside the band, and never below one unit for a reorder (guardrail G-B5).
    limits = { min: Math.max(1, Math.ceil(qty * (1 - pct))), max: Math.floor(qty * (1 + pct)) };
  }

  return {
    run_date: run.as_of_date,
    is_festival_month: run.is_festival,
    sku: {
      sku_id: sku.sku_id,
      name: sku.name,
      category: sku.category,
      perishability: sku.perishability,
      standard_reorder_qty: sku.standard_reorder_qty,
      unit: sku.uom,
    },
    metrics: {
      avg_weekly_sales: round(flag.avg_weekly_sales, 2),
      recent_4wk_avg: round(flag.recent_avg, 2),
      demand_ratio: round(flag.demand_ratio, 4),
      festival_uplift: flag.uplift,
      demand_rate: round(flag.demand_rate, 2),
      units_on_hand: flag.units_on_hand,
      cover_weeks: round(flag.cover_weeks, 2),
      min_cover_weeks: flag.min_cover,
      max_cover_weeks: flag.max_cover,
    },
    flags: flag.flag_types,
    rule_engine: { action: flag.rule_action, quantity: qty, multiplier: flag.multiplier },
    allowed_actions: [flag.rule_action],
    quantity_limits: limits,
    needs_judgment_from_engine: flag.needs_judgment,
    judgment_reasons: flag.judgment_reasons,
  };
}
