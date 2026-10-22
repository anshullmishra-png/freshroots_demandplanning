import rulesJson from "../../../config/rules.json";

// Typed view of config/rules.json. Every threshold in the system is read from here (guardrail G-R1).
export interface RulesConfig {
  version: string;
  rules: {
    recent_window_weeks: number;
    average_window_weeks: number;
    average_window_includes_recent: boolean;
    high_demand_threshold_pct: number;
    high_demand_reorder_multiplier: number;
    stockout_cover_weeks: number;
    overstock_cover_weeks: number;
    festival_demand_uplift_pct: number;
    festival_months_source: string;
    perishable: {
      applies_to_perishability: string[];
      min_cover_weeks: number;
      max_cover_weeks: number;
    };
    stockout_reorder_multiplier: number;
    combined_flag_multiplier_policy: string;
    needs_judgment: {
      week_on_week_swing_pct: number;
    };
  };
  ai: {
    provider: string;
    model_env_var: string;
    temperature: number;
    deviation_policy: "none" | "bounded";
    bounded_deviation_pct: number;
    max_retries: number;
    timeout_seconds: number;
    concurrency: number;
    retry_delay_ms: number;
    /** Warn Raghav and Deepa when more than this share of a run's decisions are fallbacks. */
    fallback_warning_pct: number;
  };
  kill_switch_1: {
    enabled: boolean;
    min_reviewed_decisions: number;
    reversal_rate_threshold_pct: number;
    operator: string;
    scope: string;
    reversal_definition: string;
    exclude_ai_fallback_decisions: boolean;
    counts_only_reviewed_decisions: boolean;
    restart_count_on_rearm: boolean;
  };
  kill_switch_2: {
    enabled: boolean;
    alert_above_rupees: number;
    kill_above_rupees: number;
    period: string;
    quarter_start_month: number;
    evaluation: string;
  };
  baseline_per_quarter_rupees: Record<string, number>;
  data_guardrails: {
    min_weeks_of_sales_required: number;
    max_inventory_age_days: number;
    block_run_on_validation_error: boolean;
    stock_vs_peak_weekly_sales_warning_multiple: number;
    max_file_bytes: number;
    max_rows_per_file: number;
  };
  timezone: string;
}

export function loadRules(): RulesConfig {
  return rulesJson as RulesConfig;
}
