import type { FlagType, RuleAction } from "@/lib/rules/types";

export type Confidence = "LOW" | "MEDIUM" | "HIGH";

/** The only data sent to the model for one flag (docs/04-AI-SPEC.md). No names of people, prices or suppliers. */
export interface AiInput {
  run_date: string;
  is_festival_month: boolean;
  sku: {
    sku_id: string;
    name: string;
    category: string;
    perishability: "Low" | "High";
    standard_reorder_qty: number;
    unit: string;
  };
  metrics: {
    avg_weekly_sales: number;
    recent_4wk_avg: number;
    demand_ratio: number;
    festival_uplift: number;
    demand_rate: number;
    units_on_hand: number;
    cover_weeks: number;
    min_cover_weeks: number;
    max_cover_weeks: number;
  };
  flags: FlagType[];
  rule_engine: { action: RuleAction; quantity: number; multiplier: number };
  allowed_actions: RuleAction[];
  quantity_limits: { min: number; max: number };
  needs_judgment_from_engine: boolean;
  judgment_reasons: string[];
}

/** What the model must return, exactly. */
export interface AiOutput {
  sku_id: string;
  action: RuleAction;
  quantity: number;
  explanation: string;
  confidence: Confidence;
  needs_judgment: boolean;
  judgment_note: string | null;
}

export interface AttemptLog {
  attempt: number;
  latency_ms: number;
  outcome: "valid" | "invalid" | "api_error";
  /** Validation errors, or the (redacted) API error message. */
  errors: string[];
  raw_response: string | null;
}

/** One AI decision for one flag. Mirrors the `ai_decisions` table (docs/03-DATA-SPEC.md). */
export interface AiDecisionResult {
  sku_id: string;
  model: string;
  prompt_version: string;
  input_json: AiInput;
  action: RuleAction;
  quantity: number;
  explanation: string;
  /** Null for a fallback decision: the rule engine, not a model, produced it. */
  confidence: Confidence | null;
  needs_judgment: boolean;
  judgment_note: string | null;
  /** True only when a model response passed every validator check. */
  valid: boolean;
  invalid_reasons: string[];
  /** True when the rule engine's answer was used because the AI failed (guardrail G-A5). */
  is_fallback: boolean;
  /** The last raw model response, if any. */
  raw_response_json: string | null;
  latency_ms: number;
  attempts: AttemptLog[];
}

export interface DecisionBatch {
  decisions: AiDecisionResult[];
  fallback_count: number;
  fallback_rate_pct: number;
  /** More than `ai.fallback_warning_pct` of the run is fallback: warn Raghav and Deepa. */
  fallback_warning: boolean;
}

/** Fallback decisions are not AI decisions, so Kill 1 ignores them (config: exclude_ai_fallback_decisions). */
export function countsTowardKill1(d: Pick<AiDecisionResult, "is_fallback">): boolean {
  return !d.is_fallback;
}
