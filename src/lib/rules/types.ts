export type FlagType = "HIGH_DEMAND" | "STOCKOUT_RISK" | "OVERSTOCK_RISK";

/** Order matters: flag lists are always written in this order so output is stable. */
export const FLAG_ORDER: FlagType[] = ["HIGH_DEMAND", "STOCKOUT_RISK", "OVERSTOCK_RISK"];

export type RuleAction = "REORDER" | "PAUSE_ORDER";

/** One flagged SKU: the rule engine's metrics, flags and recommended action (docs/02-BUSINESS-RULES.md). */
export interface FlagRecord {
  sku_id: string;
  flag_types: FlagType[];
  avg_weekly_sales: number;
  recent_avg: number;
  demand_ratio: number;
  uplift: number;
  demand_rate: number;
  units_on_hand: number;
  cover_weeks: number;
  min_cover: number;
  max_cover: number;
  standard_qty: number;
  /** The multiplier applied to the standard quantity. 0 for PAUSE_ORDER. */
  multiplier: number;
  rule_action: RuleAction;
  rule_qty: number;
  needs_judgment: boolean;
  judgment_reasons: string[];
}

/** Where one forecast SKU stands against its allowed cover band, flagged or not. Used for the stock-cover chart. */
export interface SkuCover {
  sku_id: string;
  cover_weeks: number;
  min_cover: number;
  max_cover: number;
  units_on_hand: number;
  demand_rate: number;
  flag_types: FlagType[];
}

export interface SkippedSku {
  sku_id: string;
  reason: string;
}

export interface RunResult {
  as_of_date: string;
  last_complete_week: string;
  is_festival: boolean;
  uplift: number;
  rules_version: string;
  /** Flagged SKUs, sorted by SKU id. */
  flags: FlagRecord[];
  /** Every forecast SKU's cover against its band (flagged or not), sorted by SKU id. */
  covers: SkuCover[];
  /** SKUs that were checked and have no flag (NO_ACTION). Not sent to the AI, not shown for review. */
  unflagged: string[];
  /** SKUs that could not be forecast. Raghav must handle these himself. */
  skipped: SkippedSku[];
}
