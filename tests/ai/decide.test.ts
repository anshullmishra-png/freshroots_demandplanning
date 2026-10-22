import { describe, expect, it } from "vitest";
import { decideFlag, generateDecisions } from "@/lib/ai/decide";
import { buildFallback } from "@/lib/ai/fallback";
import { createMockClient, echoHandler } from "@/lib/ai/mock";
import { countsTowardKill1 } from "@/lib/ai/types";
import { runRuleEngine } from "@/lib/rules/engine";
import { flat, synth } from "../helpers/synth";
import { fastRules, goodAnswer, prompts, seedContext } from "../helpers/ai";

const MODEL = "test-model";

function decide(handler: Parameters<typeof createMockClient>[0], rulesPatch?: Parameters<typeof fastRules>[0], sku = "SKU001") {
  const rules = fastRules(rulesPatch);
  const ctx = seedContext(rules);
  const client = createMockClient(handler);
  const promise = decideFlag(client, ctx.input(sku), { model: MODEL, prompts, rules, validator: ctx.validator });
  return { client, promise, ctx };
}

describe("E. a valid response", () => {
  it("is stored as a valid, non-fallback AI decision with its audit fields", async () => {
    const { promise, client } = decide(() => goodAnswer());
    const d = await promise;
    expect(client.calls).toHaveLength(1);
    expect(d).toMatchObject({
      sku_id: "SKU001",
      model: MODEL,
      prompt_version: "flag-decision/1.0.0",
      action: "REORDER",
      quantity: 750,
      confidence: "HIGH",
      needs_judgment: false,
      valid: true,
      is_fallback: false,
      invalid_reasons: [],
    });
    expect(d.input_json.sku.sku_id).toBe("SKU001");
    expect(d.raw_response_json).toBe(goodAnswer());
    expect(d.attempts.map((a) => a.outcome)).toEqual(["valid"]);
  });

  it("sends the system prompt, temperature 0, the response schema and the timeout", async () => {
    const { promise, client } = decide(() => goodAnswer());
    await promise;
    const req = client.calls[0];
    expect(req.systemPrompt).toBe(prompts.system);
    expect(req.temperature).toBe(0);
    expect(req.timeoutMs).toBe(30_000);
    expect(req.responseSchema).toMatchObject({ type: "object", additionalProperties: false });
    expect(req.userPrompt).toContain('"sku_id": "SKU001"');
  });
});

describe("E. invalid responses are retried with the errors, then fall back", () => {
  it("an action that is not allowed: retries twice, then falls back", async () => {
    const { promise, client } = decide(() => goodAnswer({ action: "PAUSE_ORDER", quantity: 0 }));
    const d = await promise;
    expect(client.calls).toHaveLength(3); // 1 try + ai.max_retries (2)
    expect(client.calls[0].userPrompt).not.toContain("previous answer was rejected");
    expect(client.calls[1].userPrompt).toContain("previous answer was rejected");
    expect(client.calls[1].userPrompt).toContain("action PAUSE_ORDER is not allowed");
    expect(d.is_fallback).toBe(true);
    expect(d.valid).toBe(false);
    expect(d.invalid_reasons.join(" ")).toContain("not allowed");
    expect(d.attempts.map((a) => a.outcome)).toEqual(["invalid", "invalid", "invalid"]);
  });

  it("recovers when the retry is valid: still an AI decision, 2 attempts", async () => {
    const { promise, client } = decide((_req, i) => (i === 0 ? goodAnswer({ quantity: 700 }) : goodAnswer()));
    const d = await promise;
    expect(client.calls).toHaveLength(2);
    expect(d).toMatchObject({ valid: true, is_fallback: false, quantity: 750 });
    expect(d.attempts.map((a) => a.outcome)).toEqual(["invalid", "valid"]);
  });

  it("the retry count comes from config", async () => {
    const { promise, client } = decide(() => "not json", (c) => (c.ai.max_retries = 0));
    const d = await promise;
    expect(client.calls).toHaveLength(1);
    expect(d.is_fallback).toBe(true);
  });

  it("malformed JSON: retry up to 2 times, then fallback", async () => {
    const { promise, client } = decide(() => "{ not json");
    const d = await promise;
    expect(client.calls).toHaveLength(3);
    expect(d.is_fallback).toBe(true);
    expect(d.invalid_reasons[0]).toContain("not valid JSON");
  });
});

describe("E. API failures and timeouts fall back too", () => {
  it("an API error: retried, then fallback", async () => {
    const { promise, client } = decide(() => {
      throw new Error("503 Service Unavailable");
    });
    const d = await promise;
    expect(client.calls).toHaveLength(3);
    expect(d.is_fallback).toBe(true);
    expect(d.invalid_reasons[0]).toContain("AI call failed: Error: 503 Service Unavailable");
    expect(d.attempts.every((a) => a.outcome === "api_error")).toBe(true);
    expect(d.raw_response_json).toBeNull();
  });

  it("an API error followed by a good answer is a normal AI decision", async () => {
    const { promise } = decide((_req, i) => {
      if (i === 0) throw new Error("429 Too Many Requests");
      return goodAnswer();
    });
    const d = await promise;
    expect(d).toMatchObject({ valid: true, is_fallback: false });
    expect(d.attempts.map((a) => a.outcome)).toEqual(["api_error", "valid"]);
  });

  it("a call that never answers times out, is retried, then falls back", async () => {
    const { promise, client } = decide(() => new Promise<string>(() => {}), (c) => (c.ai.timeout_seconds = 0.03));
    const d = await promise;
    expect(client.calls).toHaveLength(3);
    expect(d.is_fallback).toBe(true);
    expect(d.attempts[0].errors[0]).toContain("TimeoutError");
  });

  it("waits ai.retry_delay_ms between failed calls", async () => {
    const started = Date.now();
    const { promise } = decide(() => {
      throw new Error("down");
    }, (c) => (c.ai.retry_delay_ms = 60));
    await promise;
    expect(Date.now() - started).toBeGreaterThanOrEqual(110); // two waits of 60 ms
  });
});

describe("E. the fallback decision", () => {
  it("uses the rule engine's action and quantity with a templated explanation and no confidence", async () => {
    const { promise, ctx } = decide(() => "nope");
    const d = await promise;
    const fb = buildFallback(ctx.input("SKU001"));
    expect(d).toMatchObject({ action: "REORDER", quantity: 750, confidence: null, valid: false, is_fallback: true });
    expect(d.explanation).toBe(fb.explanation);
    expect(d.explanation).toBe(
      "Cover is 3.35 weeks against a minimum of 6. Recent sales are 21.44% above the average. A 25% festival uplift was applied. Rule engine recommends reordering 750 units.",
    );
  });

  it("a pause fallback reads naturally", () => {
    const fb = buildFallback(seedContext().input("SKU006"));
    expect(fb).toMatchObject({ action: "PAUSE_ORDER", quantity: 0 });
    expect(fb.explanation).toBe(
      "Cover is 22.23 weeks against a maximum of 14. A 25% festival uplift was applied. Rule engine recommends pausing the next order.",
    );
  });

  it("keeps the engine's needs_judgment", () => {
    const input = { ...seedContext().input("SKU001"), needs_judgment_from_engine: true, judgment_reasons: ["A week with zero sales in the last 12 weeks."] };
    const fb = buildFallback(input);
    expect(fb.needs_judgment).toBe(true);
    expect(fb.judgment_note).toContain("zero sales");
  });

  it("is excluded from the Kill 1 count", async () => {
    const fallback = await decide(() => "nope").promise;
    const real = await decide(() => goodAnswer()).promise;
    expect(countsTowardKill1(fallback)).toBe(false);
    expect(countsTowardKill1(real)).toBe(true);
  });
});

describe("E. a whole run", () => {
  it("decides every flagged SKU, in flag order, and nothing else", async () => {
    const rules = fastRules();
    const ctx = seedContext(rules);
    const client = createMockClient(echoHandler);
    const batch = await generateDecisions({ client, run: ctx.run, skus: ctx.skus, rules, model: MODEL, prompts });
    expect(batch.decisions.map((d) => d.sku_id)).toEqual(ctx.run.flags.map((f) => f.sku_id));
    expect(batch.decisions).toHaveLength(7);
    // Only flagged SKUs ever reach the model (G-A1).
    expect(new Set(client.calls.map((c) => c.input.sku.sku_id))).toEqual(new Set(ctx.run.flags.map((f) => f.sku_id)));
    expect(client.calls).toHaveLength(7);
    expect(batch.fallback_count).toBe(0);
    expect(batch.fallback_warning).toBe(false);
    // The deterministic fallback wording also passes the validator, so an echo run is all valid AI decisions.
    expect(batch.decisions.every((d) => d.valid && !d.is_fallback)).toBe(true);
  });

  it("the AI never changes the rule engine's action or quantity (default policy)", async () => {
    const rules = fastRules();
    const ctx = seedContext(rules);
    const batch = await generateDecisions({ client: createMockClient(echoHandler), run: ctx.run, skus: ctx.skus, rules, model: MODEL, prompts });
    batch.decisions.forEach((d, i) => {
      expect([d.action, d.quantity]).toEqual([ctx.run.flags[i].rule_action, ctx.run.flags[i].rule_qty]);
    });
  });

  describe("over 30% fallbacks raises a run-level warning", () => {
    // 10 flagged SKUs; the mock fails the chosen number of them.
    const data = synth(Array.from({ length: 10 }, (_, i) => ({ id: `SKU${String(i + 1).padStart(3, "0")}`, weekly: flat(), onHand: 100 })));
    const rules = fastRules();
    const run = runRuleEngine(data, rules);

    it.each([
      [2, 20, false],
      [3, 30, false], // exactly 30% is not "more than 30%"
      [4, 40, true],
    ])("%i of 10 fallbacks (%i%%) warning=%s", async (failing, pct, warning) => {
      const bad = new Set(run.flags.slice(0, failing).map((f) => f.sku_id));
      const client = createMockClient((req, ) => (bad.has(req.input.sku.sku_id) ? "garbage" : echoHandler(req, 0)));
      const batch = await generateDecisions({ client, run, skus: data.skus, rules, model: MODEL, prompts });
      expect(batch.fallback_count).toBe(failing);
      expect(batch.fallback_rate_pct).toBeCloseTo(pct);
      expect(batch.fallback_warning).toBe(warning);
    });
  });

  it("limits how many requests run at once to ai.concurrency, and keeps order", async () => {
    const data = synth(Array.from({ length: 12 }, (_, i) => ({ id: `SKU${String(i + 1).padStart(3, "0")}`, weekly: flat(), onHand: 100 })));
    const rules = fastRules((c) => (c.ai.concurrency = 3));
    const run = runRuleEngine(data, rules);
    let inFlight = 0;
    let peak = 0;
    const client = createMockClient(async (req) => {
      inFlight++;
      peak = Math.max(peak, inFlight);
      await new Promise((r) => setTimeout(r, 10));
      inFlight--;
      return echoHandler(req, 0);
    });
    const batch = await generateDecisions({ client, run, skus: data.skus, rules, model: MODEL, prompts });
    expect(peak).toBe(3);
    expect(batch.decisions.map((d) => d.sku_id)).toEqual(run.flags.map((f) => f.sku_id));
  });

  it("an empty run produces an empty batch and no warning", async () => {
    const rules = fastRules();
    const ctx = seedContext(rules);
    const batch = await generateDecisions({ client: createMockClient(), run: { ...ctx.run, flags: [] }, skus: ctx.skus, rules, model: MODEL, prompts });
    expect(batch).toEqual({ decisions: [], fallback_count: 0, fallback_rate_pct: 0, fallback_warning: false });
  });
});
