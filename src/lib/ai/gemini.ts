import { GoogleGenAI } from "@google/genai";
import { redactSecrets, type GeminiClient } from "./client";

/**
 * The real Gemini client. Server-side only: it reads GEMINI_API_KEY from the environment and nothing in
 * the browser bundle may import this file (guardrail G-A7; checked by scripts/check-bundle-secrets.mjs).
 * The model name is passed in per call from GEMINI_MODEL; none is hardcoded.
 */
/** The one place that names the key's variable. The health check asks here whether it is set; it never sees the value. */
export const GEMINI_KEY_VAR = "GEMINI_API_KEY";
export const geminiKeyIsSet = (env: Record<string, string | undefined>): boolean => !!env[GEMINI_KEY_VAR];

export function createGeminiClient(apiKey: string | undefined = process.env.GEMINI_API_KEY): GeminiClient {
  if (!apiKey) throw new Error("GEMINI_API_KEY is not set. Add it to .env.local (see .env.example).");
  const ai = new GoogleGenAI({ apiKey });

  return {
    async generate(req) {
      const controller = new AbortController();
      const timer = setTimeout(() => controller.abort(), req.timeoutMs);
      try {
        const response = await ai.models.generateContent({
          model: req.model,
          contents: req.userPrompt,
          config: {
            systemInstruction: req.systemPrompt,
            temperature: req.temperature,
            responseMimeType: "application/json",
            responseJsonSchema: req.responseSchema,
            abortSignal: controller.signal,
          },
        });
        return { text: response.text ?? "" };
      } catch (e) {
        // SDK errors can echo request details; never let a secret travel upward.
        const message = redactSecrets(e instanceof Error ? e.message : String(e), { ...process.env, GEMINI_API_KEY: apiKey });
        throw new Error(message);
      } finally {
        clearTimeout(timer);
      }
    },
  };
}
