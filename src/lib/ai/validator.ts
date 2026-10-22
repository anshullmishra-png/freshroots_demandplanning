import { EXPLANATION_MAX, EXPLANATION_MIN, JUDGMENT_NOTE_MAX, OUTPUT_KEYS } from "./schema";
import type { AiInput, AiOutput } from "./types";

export interface ValidatorContext {
  /** Every SKU in the master, so the explanation can be checked for mentions of other products. */
  allSkus: Array<{ sku_id: string; name: string }>;
  /** Window lengths (for example 4 and 12) that the explanation may mention as week counts. */
  windowWeeks: number[];
}

export type ValidationOutcome = { ok: true; output: AiOutput } | { ok: false; errors: string[] };

const ACTIONS = ["REORDER", "PAUSE_ORDER"];
const CONFIDENCES = ["LOW", "MEDIUM", "HIGH"];

/**
 * Runs after the model, in code (guardrails G-A1 to G-A8). A decision is valid only if every check passes.
 * Returns all problems at once so a retry can fix them together.
 */
export function validateOutput(raw: string, input: AiInput, ctx: ValidatorContext): ValidationOutcome {
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw.trim());
  } catch {
    return { ok: false, errors: ["The response was not valid JSON. Return only a JSON object, no markdown."] };
  }
  if (typeof parsed !== "object" || parsed === null || Array.isArray(parsed)) {
    return { ok: false, errors: ["The response must be a single JSON object."] };
  }
  const obj = parsed as Record<string, unknown>;
  const errors: string[] = [];

  // 1. Exact schema: no missing keys, no extra keys, right types.
  const keys = Object.keys(obj).sort();
  const missing = OUTPUT_KEYS.filter((k) => !keys.includes(k));
  const extra = keys.filter((k) => !OUTPUT_KEYS.includes(k));
  if (missing.length) errors.push(`Missing keys: ${missing.join(", ")}.`);
  if (extra.length) errors.push(`Unexpected keys: ${extra.join(", ")}. Return only the schema's keys.`);
  if (typeof obj.sku_id !== "string") errors.push("sku_id must be a string.");
  if (typeof obj.action !== "string" || !ACTIONS.includes(obj.action)) errors.push("action must be REORDER or PAUSE_ORDER.");
  if (typeof obj.quantity !== "number" || !Number.isInteger(obj.quantity) || obj.quantity < 0) {
    errors.push("quantity must be a whole number, 0 or more.");
  }
  if (typeof obj.explanation !== "string") errors.push("explanation must be a string.");
  if (typeof obj.confidence !== "string" || !CONFIDENCES.includes(obj.confidence)) {
    errors.push("confidence must be LOW, MEDIUM or HIGH.");
  }
  if (typeof obj.needs_judgment !== "boolean") errors.push("needs_judgment must be true or false.");
  if (obj.judgment_note !== null && typeof obj.judgment_note !== "string") errors.push("judgment_note must be a string or null.");
  if (errors.length) return { ok: false, errors }; // the checks below need the right types

  const out = obj as unknown as AiOutput;

  // 2. Same SKU.
  if (out.sku_id !== input.sku.sku_id) errors.push(`sku_id must be ${input.sku.sku_id}, not ${out.sku_id}.`);

  // 3. Action in the allowed set.
  if (!input.allowed_actions.includes(out.action)) {
    errors.push(`action ${out.action} is not allowed. Allowed: ${input.allowed_actions.join(", ")}.`);
  }

  // 4. Quantity inside the limits; PAUSE_ORDER is always 0; REORDER is positive (G-A2, G-B5).
  const { min, max } = input.quantity_limits;
  if (out.quantity < min || out.quantity > max) {
    errors.push(
      min === max
        ? `quantity must be exactly ${min}.`
        : `quantity must be between ${min} and ${max}.`,
    );
  }
  if (out.action === "PAUSE_ORDER" && out.quantity !== 0) errors.push("quantity must be 0 for PAUSE_ORDER.");
  if (out.action === "REORDER" && out.quantity <= 0) errors.push("quantity must be a positive number for REORDER.");

  // 5. Explanation length.
  const len = out.explanation.length;
  if (len < EXPLANATION_MIN || len > EXPLANATION_MAX) {
    errors.push(`explanation must be ${EXPLANATION_MIN} to ${EXPLANATION_MAX} characters; it is ${len}.`);
  }
  if (out.judgment_note !== null && out.judgment_note.length > JUDGMENT_NOTE_MAX) {
    errors.push(`judgment_note must be at most ${JUDGMENT_NOTE_MAX} characters.`);
  }

  // 6. Every number in the explanation must come from the input (G-A3).
  const invented = inventedNumbers(out.explanation, input, ctx.windowWeeks);
  if (invented.length) {
    errors.push(`The explanation uses numbers that were not provided: ${invented.join(", ")}. Use only numbers from the input.`);
  }

  // 7. No other SKU id or product name (G-A6 scope).
  const text = out.explanation.toLowerCase();
  const ownName = input.sku.name.toLowerCase();
  const mentioned: string[] = [];
  for (const other of ctx.allSkus) {
    if (other.sku_id === input.sku.sku_id) continue;
    if (mentionsId(text, other.sku_id)) mentioned.push(other.sku_id);
    const name = other.name.toLowerCase();
    if (name.length >= 4 && !ownName.includes(name) && !name.includes(ownName) && text.includes(name)) {
      mentioned.push(other.name);
    }
  }
  if (mentioned.length) errors.push(`The explanation mentions other products (${mentioned.join(", ")}). Mention only ${input.sku.sku_id}.`);

  // 8. The AI may raise needs_judgment, never lower it (G-A4).
  if (input.needs_judgment_from_engine && !out.needs_judgment) {
    errors.push("needs_judgment must be true because the rule engine set it to true.");
  }
  // 9. LOW confidence always means needs judgment (G-A8).
  if (out.confidence === "LOW" && !out.needs_judgment) {
    errors.push("needs_judgment must be true when confidence is LOW.");
  }

  return errors.length ? { ok: false, errors } : { ok: true, output: out };
}

function mentionsId(lowerText: string, skuId: string): boolean {
  const id = skuId.toLowerCase();
  const escaped = id.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
  return new RegExp(`(^|[^a-z0-9])${escaped}($|[^a-z0-9])`).test(lowerText);
}

/** Numbers written as digits in the explanation that are not in the input (or derived from it as allowed). */
export function inventedNumbers(explanation: string, input: AiInput, windowWeeks: number[]): string[] {
  const allowed = allowedNumbers(input, windowWeeks);
  const tokens = explanation.match(/\d{1,3}(?:,\d{3})+(?:\.\d+)?|\d+(?:\.\d+)?/g) ?? [];
  const bad: string[] = [];
  for (const token of tokens) {
    if (!isAllowed(token, allowed) && !bad.includes(token)) bad.push(token);
  }
  return bad;
}

/**
 * Allowed: every number in the input (including numbers inside text such as "200ml" or the run date),
 * the percentages derived as (demand_ratio - 1) x 100 and (uplift - 1) x 100, and the window lengths.
 */
function allowedNumbers(input: AiInput, windowWeeks: number[]): number[] {
  const out: number[] = [...windowWeeks];
  const walk = (v: unknown) => {
    if (typeof v === "number") out.push(v);
    else if (typeof v === "string") for (const m of v.match(/\d+(?:\.\d+)?/g) ?? []) out.push(Number(m));
    else if (Array.isArray(v)) v.forEach(walk);
    else if (v && typeof v === "object") Object.values(v).forEach(walk);
  };
  walk(input);
  out.push((input.metrics.demand_ratio - 1) * 100);
  out.push((input.metrics.festival_uplift - 1) * 100);
  return out;
}

/** A written number matches if it equals an allowed number rounded to the written number's decimals. */
function isAllowed(token: string, allowed: number[]): boolean {
  const written = Number(token.replace(/,/g, ""));
  const decimals = token.includes(".") ? token.split(".")[1].length : 0;
  return allowed.some((a) => a === written || Number(roundHalfUp(a, decimals)) === written);
}

function roundHalfUp(n: number, decimals: number): string {
  const f = 10 ** decimals;
  return (Math.floor(n * f + 0.5 + 1e-9) / f).toFixed(decimals);
}
