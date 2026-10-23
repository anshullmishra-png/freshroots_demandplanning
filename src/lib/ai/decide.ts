import type { RulesConfig } from "@/lib/config/rules";
import type { RunResult } from "@/lib/rules/types";
import type { SkuRow } from "@/lib/validation/types";
import { redactSecrets, withTimeout, type GeminiClient } from "./client";
import { buildFallback } from "./fallback";
import { buildAiInput } from "./input";
import { renderUserPrompt, type PromptBundle } from "./prompts";
import { RESPONSE_SCHEMA } from "./schema";
import type { AiDecisionResult, AiInput, AttemptLog, DecisionBatch } from "./types";
import { validateOutput, type ValidatorContext } from "./validator";

const sleep = (ms: number) => (ms > 0 ? new Promise((r) => setTimeout(r, ms)) : Promise.resolve());

export function resolveModel(rules: RulesConfig, env: NodeJS.ProcessEnv = process.env): string {
  const model = env[rules.ai.model_env_var];
  if (!model) throw new Error(`${rules.ai.model_env_var} is not set. Add it to .env.local (see .env.example).`);
  return model;
}

/**
 * One flag in, one decision out. Up to `1 + ai.max_retries` attempts; each retry sends the validation errors
 * back. If every attempt fails (invalid output, bad JSON, timeout, API error) the rule engine's own answer is
 * returned as a clearly marked fallback (guardrail G-A5). This function never throws on AI failure.
 */
export async function decideFlag(
  client: GeminiClient,
  input: AiInput,
  opts: { model: string; prompts: PromptBundle; rules: RulesConfig; validator: ValidatorContext },
): Promise<AiDecisionResult> {
  const { rules, prompts, model } = opts;
  const attemptsAllowed = 1 + rules.ai.max_retries;
  const timeoutMs = rules.ai.timeout_seconds * 1000;
  const attempts: AttemptLog[] = [];
  let retryErrors: string[] = [];
  let lastRaw: string | null = null;
  let lastReasons: string[] = [];

  for (let n = 1; n <= attemptsAllowed; n++) {
    const started = performance.now();
    let text: string;
    try {
      const res = await withTimeout(
        client.generate({
          model,
          systemPrompt: prompts.system,
          userPrompt: renderUserPrompt(prompts.userTemplate, input, retryErrors),
          responseSchema: RESPONSE_SCHEMA,
          temperature: rules.ai.temperature,
          timeoutMs,
          input,
          attempt: n,
        }),
        timeoutMs,
      );
      text = res.text;
    } catch (e) {
      const message = redactSecrets(e instanceof Error ? `${e.name}: ${e.message}` : String(e)).slice(0, 300);
      attempts.push({ attempt: n, latency_ms: elapsed(started), outcome: "api_error", errors: [message], raw_response: null });
      lastReasons = [`AI call failed: ${message}`];
      if (n < attemptsAllowed) await sleep(rules.ai.retry_delay_ms);
      continue;
    }

    text = redactSecrets(text ?? "");
    lastRaw = text;
    const outcome = validateOutput(text, input, opts.validator);
    if (outcome.ok) {
      attempts.push({ attempt: n, latency_ms: elapsed(started), outcome: "valid", errors: [], raw_response: text });
      const o = outcome.output;
      return {
        sku_id: input.sku.sku_id,
        model,
        prompt_version: prompts.version,
        input_json: input,
        action: o.action,
        quantity: o.quantity,
        explanation: o.explanation,
        confidence: o.confidence,
        needs_judgment: o.needs_judgment,
        judgment_note: o.judgment_note,
        valid: true,
        invalid_reasons: [],
        is_fallback: false,
        raw_response_json: text,
        latency_ms: total(attempts),
        attempts,
      };
    }
    attempts.push({ attempt: n, latency_ms: elapsed(started), outcome: "invalid", errors: outcome.errors, raw_response: text });
    retryErrors = outcome.errors; // the retry tells the model exactly what was wrong
    lastReasons = outcome.errors;
  }

  const fb = buildFallback(input);
  return {
    sku_id: input.sku.sku_id,
    model,
    prompt_version: prompts.version,
    input_json: input,
    action: fb.action,
    quantity: fb.quantity,
    explanation: fb.explanation,
    confidence: null,
    needs_judgment: fb.needs_judgment,
    judgment_note: fb.judgment_note,
    valid: false,
    invalid_reasons: lastReasons,
    is_fallback: true,
    raw_response_json: lastRaw,
    latency_ms: total(attempts),
    attempts,
  };
}

function elapsed(started: number): number {
  return Math.round(performance.now() - started);
}
function total(attempts: AttemptLog[]): number {
  return attempts.reduce((sum, a) => sum + a.latency_ms, 0);
}

/**
 * Decisions for every flag in a run: one request per flag, a small concurrency limit (ai.concurrency),
 * results in flag order. Only flagged SKUs are ever sent to the model (G-A1).
 */
export async function generateDecisions(args: {
  client: GeminiClient;
  /** Only the flags and run context are read, so a run can be decided a batch of flags at a time. */
  run: Pick<RunResult, "flags" | "as_of_date" | "is_festival">;
  skus: SkuRow[];
  rules: RulesConfig;
  model: string;
  prompts: PromptBundle;
}): Promise<DecisionBatch> {
  const { client, run, skus, rules, model, prompts } = args;
  const bySku = new Map(skus.map((s) => [s.sku_id, s]));
  const validator: ValidatorContext = {
    allSkus: skus.map((s) => ({ sku_id: s.sku_id, name: s.name })),
    windowWeeks: [rules.rules.recent_window_weeks, rules.rules.average_window_weeks],
  };

  const decisions = new Array<AiDecisionResult>(run.flags.length);
  let next = 0;
  const worker = async () => {
    for (;;) {
      const i = next++;
      if (i >= run.flags.length) return;
      const flag = run.flags[i];
      const sku = bySku.get(flag.sku_id);
      if (!sku) throw new Error(`Flag for unknown SKU ${flag.sku_id}`);
      const input = buildAiInput(flag, sku, run, rules);
      decisions[i] = await decideFlag(client, input, { model, prompts, rules, validator });
    }
  };
  const workers = Math.max(1, Math.min(rules.ai.concurrency, run.flags.length));
  await Promise.all(Array.from({ length: workers }, worker));

  const fallbackCount = decisions.filter((d) => d.is_fallback).length;
  const ratePct = decisions.length === 0 ? 0 : (fallbackCount / decisions.length) * 100;
  return {
    decisions,
    fallback_count: fallbackCount,
    fallback_rate_pct: ratePct,
    // "More than 30%": strictly above.
    fallback_warning: ratePct > rules.ai.fallback_warning_pct,
  };
}
