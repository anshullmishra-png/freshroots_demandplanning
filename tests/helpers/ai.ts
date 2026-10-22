import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { buildAiInput } from "@/lib/ai/input";
import { loadPrompts } from "@/lib/ai/prompts";
import type { AiInput } from "@/lib/ai/types";
import type { ValidatorContext } from "@/lib/ai/validator";
import { runRuleEngine } from "@/lib/rules/engine";
import type { RunResult } from "@/lib/rules/types";
import type { SkuRow } from "@/lib/validation/types";
import { NOW, seedFiles, validate, withRules } from "./seed";

export const prompts = loadPrompts(path.resolve(__dirname, "../../prompts"));

/** Rules for fast tests: no waiting between retries. */
export function fastRules(patch?: (c: RulesConfig) => void): RulesConfig {
  return withRules((c) => {
    c.ai.retry_delay_ms = 0;
    patch?.(c);
  });
}

export interface SeedContext {
  rules: RulesConfig;
  run: RunResult;
  skus: SkuRow[];
  validator: ValidatorContext;
  input(skuId: string): AiInput;
}

/** The seed data through validation, the rule engine, and the input builder. */
export function seedContext(rules: RulesConfig = loadRules()): SeedContext {
  const v = validate(seedFiles(), { rules, now: NOW });
  if (!v.ok) throw new Error("seed did not validate");
  const run = runRuleEngine(v.data!, rules);
  const skus = v.data!.skus;
  const bySku = new Map(skus.map((s) => [s.sku_id, s]));
  return {
    rules,
    run,
    skus,
    validator: {
      allSkus: skus.map((s) => ({ sku_id: s.sku_id, name: s.name })),
      windowWeeks: [rules.rules.recent_window_weeks, rules.rules.average_window_weeks],
    },
    input(skuId) {
      const flag = run.flags.find((f) => f.sku_id === skuId);
      if (!flag) throw new Error(`${skuId} is not flagged in the seed`);
      return buildAiInput(flag, bySku.get(skuId)!, run, rules);
    },
  };
}

/** A valid model answer for SKU001 (REORDER 750). Override any field to break it. */
export function goodAnswer(over: Record<string, unknown> = {}): string {
  return JSON.stringify({
    sku_id: "SKU001",
    action: "REORDER",
    quantity: 750,
    explanation:
      "Cover is 3.35 weeks against a minimum of 6, and recent sales are 21.4% above the 12-week average. " +
      "A 25% festival uplift was applied. Reorder 750 units.",
    confidence: "HIGH",
    needs_judgment: false,
    judgment_note: null,
    ...over,
  });
}

export function readProjectFile(...parts: string[]): string {
  return readFileSync(path.resolve(__dirname, "../..", ...parts), "utf8");
}
