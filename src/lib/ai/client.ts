import type { AiInput } from "./types";

export interface GenerateRequest {
  model: string;
  systemPrompt: string;
  userPrompt: string;
  /** JSON schema for the response format. */
  responseSchema: object;
  temperature: number;
  timeoutMs: number;
  /** The structured input behind the prompt. Used by mock clients only; the real client never sends it separately. */
  input: AiInput;
  attempt: number;
}

export interface GenerateResponse {
  text: string;
}

/** The only thing the decision step needs from a model provider. Real: Gemini. Tests and demos: a mock. */
export interface GeminiClient {
  generate(req: GenerateRequest): Promise<GenerateResponse>;
}

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)/i;

/**
 * Removes any secret from text before it is stored or logged (guardrail G-S2). A secret is the value of
 * any environment variable whose name suggests one. Error messages from SDKs sometimes echo request details.
 */
export function redactSecrets(text: string, env: Record<string, string | undefined> = process.env): string {
  let out = text;
  for (const [name, value] of Object.entries(env)) {
    if (value && value.length >= 8 && SECRET_NAME.test(name)) out = out.split(value).join("[REDACTED]");
  }
  return out;
}

export class TimeoutError extends Error {
  constructor(ms: number) {
    super(`The AI call timed out after ${ms} ms.`);
    this.name = "TimeoutError";
  }
}

export function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  let timer: ReturnType<typeof setTimeout>;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new TimeoutError(ms)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}
