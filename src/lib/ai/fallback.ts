import type { AiInput, AiOutput } from "./types";

const fmt = (n: number) => String(Number(n.toFixed(2)));

/**
 * The rule engine's own answer, with a deterministic explanation built from the metrics, used when the AI
 * fails (guardrail G-A5). It carries no confidence: a model did not produce it.
 */
export function buildFallback(input: AiInput): Omit<AiOutput, "confidence"> & { confidence: null } {
  const m = input.metrics;
  const parts: string[] = [];
  if (input.flags.includes("STOCKOUT_RISK")) {
    parts.push(`Cover is ${fmt(m.cover_weeks)} weeks against a minimum of ${fmt(m.min_cover_weeks)}.`);
  }
  if (input.flags.includes("OVERSTOCK_RISK")) {
    parts.push(`Cover is ${fmt(m.cover_weeks)} weeks against a maximum of ${fmt(m.max_cover_weeks)}.`);
  }
  if (input.flags.includes("HIGH_DEMAND")) {
    parts.push(`Recent sales are ${fmt((m.demand_ratio - 1) * 100)}% above the average.`);
  }
  if (input.is_festival_month && m.festival_uplift > 1) {
    parts.push(`A ${fmt((m.festival_uplift - 1) * 100)}% festival uplift was applied.`);
  }
  const { action, quantity } = input.rule_engine;
  parts.push(
    action === "REORDER"
      ? `Rule engine recommends reordering ${quantity} units.`
      : "Rule engine recommends pausing the next order.",
  );
  return {
    sku_id: input.sku.sku_id,
    action,
    quantity,
    explanation: parts.join(" "),
    confidence: null,
    needs_judgment: input.needs_judgment_from_engine,
    judgment_note: input.judgment_reasons.length ? input.judgment_reasons.join(" ").slice(0, 200) : null,
  };
}
