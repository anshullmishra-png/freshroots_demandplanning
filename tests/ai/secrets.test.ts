import { readdirSync, readFileSync, statSync } from "node:fs";
import path from "node:path";
import { afterEach, describe, expect, it, vi } from "vitest";
import { redactSecrets } from "@/lib/ai/client";
import { decideFlag } from "@/lib/ai/decide";
import { createGeminiClient } from "@/lib/ai/gemini";
import { createMockClient } from "@/lib/ai/mock";
import { fastRules, goodAnswer, prompts, seedContext } from "../helpers/ai";

const FAKE_KEY = "FAKE-TEST-KEY-abcdefghijklmnopqrstuvwxyz0123456789";

afterEach(() => vi.unstubAllEnvs());

describe("E. the API key never leaks (G-A7, G-S2)", () => {
  it("redacts any secret-named environment value from text", () => {
    const env = { GEMINI_API_KEY: FAKE_KEY, DATABASE_URL: "fake-connection-string-value-123", SOME_NAME: "not-a-secret-name-value" };
    const text = `failed for ${FAKE_KEY} and fake-connection-string-value-123 and not-a-secret-name-value`;
    expect(redactSecrets(text, env)).toBe("failed for [REDACTED] and [REDACTED] and not-a-secret-name-value");
  });

  it("an API error that echoes the key is stored redacted, in the result and in every attempt", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_KEY);
    const spies = (["log", "info", "warn", "error", "debug"] as const).map((m) => vi.spyOn(console, m).mockImplementation(() => {}));
    const rules = fastRules();
    const ctx = seedContext(rules);
    const client = createMockClient(() => {
      throw new Error(`Request to https://example.test/v1?key=${FAKE_KEY} failed`);
    });
    const d = await decideFlag(client, ctx.input("SKU001"), { model: "m", prompts, rules, validator: ctx.validator });
    expect(JSON.stringify(d)).not.toContain(FAKE_KEY);
    expect(d.attempts[0].errors[0]).toContain("[REDACTED]");
    // The step writes no logs at all, so nothing can leak there either.
    for (const spy of spies) expect(JSON.stringify(spy.mock.calls)).not.toContain(FAKE_KEY);
    spies.forEach((s) => s.mockRestore());
  });

  it("a model response that contains the key is stored redacted", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_KEY);
    const rules = fastRules((c) => (c.ai.max_retries = 0));
    const ctx = seedContext(rules);
    const client = createMockClient(() => `oops ${FAKE_KEY}`);
    const d = await decideFlag(client, ctx.input("SKU001"), { model: "m", prompts, rules, validator: ctx.validator });
    expect(d.raw_response_json).not.toContain(FAKE_KEY);
    expect(JSON.stringify(d)).not.toContain(FAKE_KEY);
  });

  it("the real client refuses to start without a key", () => {
    vi.stubEnv("GEMINI_API_KEY", "");
    expect(() => createGeminiClient()).toThrow(/GEMINI_API_KEY is not set/);
  });

  it("the prompts sent to the model never contain the key", async () => {
    vi.stubEnv("GEMINI_API_KEY", FAKE_KEY);
    const rules = fastRules();
    const ctx = seedContext(rules);
    const client = createMockClient(() => goodAnswer());
    await decideFlag(client, ctx.input("SKU001"), { model: "m", prompts, rules, validator: ctx.validator });
    expect(JSON.stringify(client.calls)).not.toContain(FAKE_KEY);
  });
});

describe("E. the AI code stays on the server", () => {
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const root = path.resolve(__dirname, "../../src");

  it("no page or component imports the AI modules, so they cannot reach the browser bundle", () => {
    const offenders = files(path.join(root, "app")).filter((f) => /\.(ts|tsx)$/.test(f) && /lib\/ai|@google\/genai/.test(readFileSync(f, "utf8")));
    expect(offenders).toEqual([]);
  });

  it("only the Gemini client reads GEMINI_API_KEY", () => {
    const readers = files(root).filter((f) => readFileSync(f, "utf8").includes("GEMINI_API_KEY")).map((f) => path.basename(f));
    expect(readers.sort()).toEqual(["gemini.ts"]);
  });

  it("no model name is hardcoded", () => {
    const hits = files(root).filter((f) => /["'`]gemini-[0-9a-z.-]+["'`]/.test(readFileSync(f, "utf8")));
    expect(hits).toEqual([]);
  });
});
