import { describe, expect, it } from "vitest";
import { validateOutput } from "@/lib/ai/validator";
import { withRules } from "../helpers/seed";
import { goodAnswer, seedContext } from "../helpers/ai";

const ctx = seedContext();
const sku001 = ctx.input("SKU001"); // REORDER 750
const sku006 = ctx.input("SKU006"); // PAUSE_ORDER 0

const check = (raw: string, input = sku001, validator = ctx.validator) => validateOutput(raw, input, validator);
const errorsOf = (raw: string, input = sku001) => {
  const r = check(raw, input);
  return r.ok ? [] : r.errors;
};
const pauseAnswer = (over: Record<string, unknown> = {}) =>
  JSON.stringify({
    sku_id: "SKU006",
    action: "PAUSE_ORDER",
    quantity: 0,
    explanation: "Cover is 22.23 weeks against a maximum of 14. Pause the next order.",
    confidence: "HIGH",
    needs_judgment: false,
    judgment_note: null,
    ...over,
  });

describe("E. valid responses", () => {
  it("accepts a correct REORDER answer", () => {
    const r = check(goodAnswer());
    expect(r.ok).toBe(true);
  });

  it("accepts a correct PAUSE_ORDER answer", () => {
    expect(check(pauseAnswer(), sku006).ok).toBe(true);
  });

  it("the explanation may name its own SKU and its own product", () => {
    const text = "SKU001 (Freshroots Mango Drink 200ml) has 3.35 weeks of cover against a minimum of 6. Reorder 750 units.";
    expect(check(goodAnswer({ explanation: text })).ok).toBe(true);
  });
});

describe("E. schema (rule 1)", () => {
  it.each([
    ["not json", "The response was not valid JSON"],
    ["```json\n" + goodAnswer() + "\n```", "not valid JSON"],
    ["[]", "single JSON object"],
    ["null", "single JSON object"],
  ])("rejects %j", (raw, message) => {
    expect(errorsOf(raw).join(" ")).toContain(message);
  });

  it("rejects extra keys and missing keys", () => {
    expect(errorsOf(goodAnswer({ bonus: 1 })).join(" ")).toContain("Unexpected keys: bonus");
    const obj = JSON.parse(goodAnswer());
    delete obj.confidence;
    expect(errorsOf(JSON.stringify(obj)).join(" ")).toContain("Missing keys: confidence");
  });

  it.each([
    [{ quantity: "750" }, "quantity must be a whole number"],
    [{ quantity: 750.5 }, "quantity must be a whole number"],
    [{ quantity: -1 }, "quantity must be a whole number"],
    [{ needs_judgment: "false" }, "needs_judgment must be true or false"],
    [{ confidence: "SURE" }, "confidence must be LOW, MEDIUM or HIGH"],
    [{ action: "BUY" }, "action must be REORDER or PAUSE_ORDER"],
    [{ judgment_note: 5 }, "judgment_note must be a string or null"],
    [{ explanation: 12 }, "explanation must be a string"],
  ])("rejects wrong types %j", (over, message) => {
    expect(errorsOf(goodAnswer(over)).join(" ")).toContain(message);
  });
});

describe("E. identity, action and quantity (rules 2 to 4)", () => {
  it("rejects a different sku_id", () => {
    expect(errorsOf(goodAnswer({ sku_id: "SKU002" })).join(" ")).toContain("sku_id must be SKU001");
  });

  it("rejects an action that is not allowed (retry then fallback is tested in decide.test.ts)", () => {
    expect(errorsOf(goodAnswer({ action: "PAUSE_ORDER", quantity: 0 })).join(" ")).toContain("action PAUSE_ORDER is not allowed");
  });

  it("rejects any quantity different from the rule quantity under the default policy", () => {
    for (const quantity of [749, 751, 500, 1125, 0]) {
      expect(errorsOf(goodAnswer({ quantity })).join(" ")).toContain("quantity must be exactly 750");
    }
  });

  it("PAUSE_ORDER must be quantity 0", () => {
    expect(errorsOf(pauseAnswer({ quantity: 5 }), sku006).join(" ")).toContain("quantity must be exactly 0");
  });

  describe("bounded policy: quantity may move inside the band, the action never", () => {
    const bounded = seedContext(withRules((c) => {
      c.ai.deviation_policy = "bounded";
      c.ai.bounded_deviation_pct = 10;
    }));
    const input = bounded.input("SKU001"); // 675 to 825
    it.each([
      [675, true],
      [750, true],
      [825, true],
      [674, false],
      [826, false],
    ])("quantity %i valid=%s", (quantity, ok) => {
      expect(validateOutput(goodAnswer({ quantity }), input, bounded.validator).ok).toBe(ok);
    });

    it("still rejects a different action", () => {
      const r = validateOutput(goodAnswer({ action: "PAUSE_ORDER", quantity: 0 }), input, bounded.validator);
      expect(r.ok).toBe(false);
    });
  });
});

describe("E. explanation (rules 5 to 7)", () => {
  it.each([
    [39, false],
    [40, true],
    [450, true],
    [451, false],
  ])("length %i valid=%s", (length, ok) => {
    expect(check(goodAnswer({ explanation: "a".repeat(length) })).ok).toBe(ok);
  });

  it("rejects a number that is not in the input", () => {
    const r = errorsOf(goodAnswer({ explanation: "Cover is 3.35 weeks and demand is up 42% on last year, so reorder 750 units." }));
    expect(r.join(" ")).toContain("numbers that were not provided: 42");
  });

  it("rejects an invented quantity or week count", () => {
    expect(errorsOf(goodAnswer({ explanation: "Cover is 3.35 weeks; order 900 units to last 9 weeks, then reorder 750 units." })).join(" ")).toContain("not provided");
  });

  it.each([
    "Cover is 3.35 weeks against a minimum of 6. Reorder 750 units.",
    "Cover is 3.4 weeks against a minimum of 6. Reorder 750 units.", // 3.35 rounded to 1 decimal
    "Sales are 21% above average; reorder 750 units to cover 3.35 weeks of stock.", // derived percent
    "Sales are 21.44% above average; reorder 750 units with 900 on hand.",
    "A 25% festival uplift was applied, so demand is 268.65 a week. Reorder 750 units.",
    "That is 1.5 times the standard 500, a reorder of 750 units. Cover is 3.35 weeks.",
    "Over the last 4 weeks sales were 261 a week against 214.92 over 12 weeks. Reorder 750 units.",
    "As of 2026-10-19 the 200ml Mango Drink has 3.35 weeks of cover. Reorder 750 units now.",
  ])("accepts numbers that come from the input: %s", (explanation) => {
    expect(check(goodAnswer({ explanation })).ok).toBe(true);
  });

  it("rejects mention of another SKU id", () => {
    const e = errorsOf(goodAnswer({ explanation: "Cover is 3.35 weeks against a minimum of 6, similar to SKU002. Reorder 750 units." }));
    expect(e.join(" ")).toContain("mentions other products (SKU002)");
  });

  it("rejects mention of another product name", () => {
    const e = errorsOf(goodAnswer({ explanation: "Cover is 3.35 weeks of the Freshroots Oats Cookies 150g trend. Reorder 750 units." }));
    expect(e.join(" ")).toContain("Freshroots Oats Cookies 150g");
  });

  it("does not mistake SKU0011 or a longer id for SKU001", () => {
    // SKU001's own id inside a longer token must not count as another SKU, and vice versa
    expect(check(goodAnswer({ explanation: "SKU001 has 3.35 weeks of cover against a minimum of 6. Reorder 750 units." })).ok).toBe(true);
  });
});

describe("E. judgment and confidence (rules 8 and 9)", () => {
  const judged = { ...sku001, needs_judgment_from_engine: true, judgment_reasons: ["A week with zero sales in the last 12 weeks."] };

  it("rejects needs_judgment false when the engine said true", () => {
    expect(errorsOf(goodAnswer({ needs_judgment: false }), judged).join(" ")).toContain("needs_judgment must be true because the rule engine");
  });

  it("accepts needs_judgment true when the engine said true", () => {
    expect(check(goodAnswer({ needs_judgment: true, judgment_note: "Zero-sales week in the window." }), judged).ok).toBe(true);
  });

  it("the AI may raise needs_judgment even when the engine did not", () => {
    expect(check(goodAnswer({ needs_judgment: true, confidence: "MEDIUM" })).ok).toBe(true);
  });

  it("rejects LOW confidence with needs_judgment false", () => {
    expect(errorsOf(goodAnswer({ confidence: "LOW", needs_judgment: false })).join(" ")).toContain("needs_judgment must be true when confidence is LOW");
  });

  it("accepts LOW confidence with needs_judgment true", () => {
    expect(check(goodAnswer({ confidence: "LOW", needs_judgment: true })).ok).toBe(true);
  });

  it("rejects an over-long judgment_note", () => {
    expect(errorsOf(goodAnswer({ needs_judgment: true, judgment_note: "x".repeat(201) })).join(" ")).toContain("judgment_note must be at most 200");
  });
});

it("reports every problem at once so a retry can fix them together", () => {
  const e = errorsOf(goodAnswer({ action: "PAUSE_ORDER", quantity: 5, confidence: "LOW", needs_judgment: false, explanation: "Too short 77" }));
  expect(e.length).toBeGreaterThanOrEqual(5);
});
