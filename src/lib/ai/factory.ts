import type { RulesConfig } from "@/lib/config/rules";
import { MOCK_AI_IN_PRODUCTION, isProduction } from "@/lib/env/check";
import type { GeminiClient } from "./client";
import { resolveModel } from "./decide";
import { createGeminiClient } from "./gemini";
import { createMockClient, echoHandler } from "./mock";
import { loadPrompts, type PromptBundle } from "./prompts";

export interface AiRuntime {
  client: GeminiClient;
  model: string;
  prompts: PromptBundle;
  /** Overrides `ai.step_budget_seconds`. Only ever set for the mock (see below). */
  budgetMs?: number;
}

/**
 * The AI the server uses. AI_CLIENT=mock gives the scripted mock (end-to-end tests and demos with no key);
 * anything else is the real Gemini client, with the model from GEMINI_MODEL. The mock is refused on production.
 *
 * Two test hooks exist for the mock only, so the end-to-end test can make a run take several requests and watch the
 * browser carry on: AI_MOCK_DELAY_MS (each answer takes that long) and AI_STEP_BUDGET_SECONDS (a shorter budget).
 */
export function getAiRuntime(rules: RulesConfig, env: NodeJS.ProcessEnv = process.env): AiRuntime {
  if (env.AI_CLIENT === "mock") {
    // A leftover test setting must never put the rule engine's own answer in front of reviewers as "AI".
    if (isProduction(env)) throw new Error(MOCK_AI_IN_PRODUCTION);
    const delay = Number(env.AI_MOCK_DELAY_MS ?? 0);
    const budget = env.AI_STEP_BUDGET_SECONDS === undefined ? NaN : Number(env.AI_STEP_BUDGET_SECONDS);
    const client = createMockClient(async (req, i) => {
      if (delay > 0) await new Promise((r) => setTimeout(r, delay));
      return echoHandler(req, i);
    });
    return { client, model: "mock-model", prompts: loadPrompts(), budgetMs: Number.isFinite(budget) ? budget * 1000 : undefined };
  }
  return { client: createGeminiClient(), model: resolveModel(rules, env), prompts: loadPrompts() };
}
