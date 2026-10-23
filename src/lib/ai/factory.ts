import type { RulesConfig } from "@/lib/config/rules";
import { MOCK_AI_IN_PRODUCTION, isProduction } from "@/lib/env/check";
import type { GeminiClient } from "./client";
import { resolveModel } from "./decide";
import { createGeminiClient } from "./gemini";
import { createMockClient } from "./mock";
import { loadPrompts, type PromptBundle } from "./prompts";

export interface AiRuntime {
  client: GeminiClient;
  model: string;
  prompts: PromptBundle;
}

/**
 * The AI the server uses. AI_CLIENT=mock gives the scripted mock (end-to-end tests and demos with no key);
 * anything else is the real Gemini client, with the model from GEMINI_MODEL. The mock is refused on production.
 */
export function getAiRuntime(rules: RulesConfig, env: NodeJS.ProcessEnv = process.env): AiRuntime {
  if (env.AI_CLIENT === "mock") {
    // A leftover test setting must never put the rule engine's own answer in front of reviewers as "AI".
    if (isProduction(env)) throw new Error(MOCK_AI_IN_PRODUCTION);
    return { client: createMockClient(), model: "mock-model", prompts: loadPrompts() };
  }
  return { client: createGeminiClient(), model: resolveModel(rules, env), prompts: loadPrompts() };
}
