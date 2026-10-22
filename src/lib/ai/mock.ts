import type { GeminiClient, GenerateRequest } from "./client";
import { buildFallback } from "./fallback";

export type MockHandler = (req: GenerateRequest, callIndex: number) => string | Promise<string>;

/** Answers with the rule engine's decision restated as valid JSON. Used by tests and by demos with no API key. */
export const echoHandler: MockHandler = (req) => {
  const fb = buildFallback(req.input);
  return JSON.stringify({
    sku_id: fb.sku_id,
    action: fb.action,
    quantity: fb.quantity,
    explanation: fb.explanation,
    confidence: fb.needs_judgment ? "LOW" : "HIGH",
    needs_judgment: fb.needs_judgment,
    judgment_note: fb.judgment_note,
  });
};

/**
 * A scripted stand-in for Gemini. No test ever calls the real API (docs/10-TEST-PLAN.md).
 * `calls` records every request so tests can inspect prompts and count attempts.
 */
export function createMockClient(handler: MockHandler = echoHandler): GeminiClient & { calls: GenerateRequest[] } {
  const calls: GenerateRequest[] = [];
  return {
    calls,
    async generate(req) {
      const index = calls.push(req) - 1;
      return { text: await handler(req, index) };
    },
  };
}
