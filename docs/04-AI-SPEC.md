# 04: AI Spec (Google Gemini step, component #5)

## What the AI does
For each flag raised by the rule engine, Gemini returns one **decision** and an **explanation**:
- `action`: what to do (REORDER or PAUSE_ORDER)
- `quantity`: how many units
- `explanation`: a plain-language reason that explains the rule engine's flag to Raghav
- `confidence` and `needs_judgment`

## What the AI must NOT do
- Create, remove, or re-score a flag. The rule engine is the source of truth for flags.
- Look at SKUs that were not flagged.
- Use any number that was not given to it.
- Talk to Raghav in free text, take instructions from him, or call any tool.
- Decide anything for the 15-20% of cases the rules cannot cover. It can only mark them `needs_judgment`.

## Deviation policy (read `12-OPEN-QUESTIONS.md`, item 1)
`config/rules.json -> ai.deviation_policy` controls whether the AI may differ from the rule engine's action and quantity.
- `none` (DEFAULT): the AI's `action` and `quantity` must equal the rule engine's. The AI restates them in structured form and explains them. The validator rejects any difference.
- `bounded`: the AI may change quantity within +/- `bounded_deviation_pct` of the rule quantity, and must justify it in the explanation. Action may never differ.
Build both modes behind the config. Ship with `none`.

## Call pattern
- SDK: Google Gen AI SDK for TypeScript (`@google/genai`). Check the current docs for the exact package and call shape before writing code.
- Model: read from env var `GEMINI_MODEL`. Do not hardcode a model name. Before first use, verify the model ID is current in Google's docs and tell the user which one you picked.
- One request per flag (traceable, retryable), run with a small concurrency limit (5 at a time).
- `temperature: 0`. Request JSON output with the response schema below (structured output / `responseMimeType: application/json` + `responseSchema`).
- Timeout 30 s, up to 2 retries (the retry sends the validation errors back). Config: `ai.max_retries`, `ai.timeout_seconds`.
- API key from `GEMINI_API_KEY` env var. Server-side only. Never in the client bundle.

## Input sent to the model (per flag)
Prompt text is in `prompts/flag-decision.system.md` and `prompts/flag-decision.user.md`. The user message is filled with JSON like:
```json
{
  "run_date": "2026-10-19",
  "is_festival_month": true,
  "sku": {"sku_id": "SKU001", "name": "Freshroots Mango Drink 200ml", "category": "Beverage",
          "perishability": "Low", "standard_reorder_qty": 500, "unit": "Units"},
  "metrics": {"avg_weekly_sales": 214.92, "recent_4wk_avg": 261.0, "demand_ratio": 1.2144,
              "festival_uplift": 1.25, "demand_rate": 268.65, "units_on_hand": 900,
              "cover_weeks": 3.35, "min_cover_weeks": 6, "max_cover_weeks": 14},
  "flags": ["HIGH_DEMAND", "STOCKOUT_RISK"],
  "rule_engine": {"action": "REORDER", "quantity": 750, "multiplier": 1.5},
  "allowed_actions": ["REORDER"],
  "quantity_limits": {"min": 750, "max": 750},
  "needs_judgment_from_engine": false,
  "judgment_reasons": []
}
```
Do not send names of people, prices, supplier details, or anything not listed above.

## Output schema (enforced by the API and again by our validator)
```json
{
  "sku_id": "string, must equal the input sku_id",
  "action": "REORDER | PAUSE_ORDER",
  "quantity": "integer >= 0 (0 when PAUSE_ORDER)",
  "explanation": "string, max 450 characters, plain English, 2 to 3 sentences",
  "confidence": "LOW | MEDIUM | HIGH",
  "needs_judgment": "boolean",
  "judgment_note": "string or null, max 200 characters"
}
```

## Validator (runs on every response, in code, after the model)
A decision is **valid** only if ALL of these hold:
1. Parses as JSON and matches the schema exactly (no extra keys).
2. `sku_id` equals the input `sku_id`.
3. `action` is in `allowed_actions`.
4. `quantity` is an integer inside `quantity_limits` (under `none`, equal to the rule quantity). `PAUSE_ORDER` implies quantity 0.
5. `explanation` length is between 40 and 450 characters.
6. **Every number in the explanation appears in the input** (compare after rounding to the same decimals as given; allow percentages derived as `(demand_ratio - 1) x 100`; allow week counts). Any invented number makes the response invalid.
7. The explanation does not mention another SKU ID or another product name.
8. `needs_judgment` is `true` whenever `needs_judgment_from_engine` is `true`. The AI may raise it, never lower it.
9. If `confidence` is LOW then `needs_judgment` must be `true`.

## Fallback when the AI fails
If validation still fails after retries, or the API errors or times out:
- Create the `ai_decisions` row with `is_fallback = true`, `valid = false`, the rule engine's action and quantity, and a templated explanation (deterministic string built from the metrics, e.g. "Cover is 3.35 weeks against a minimum of 6. Rule engine recommends reordering 750 units.").
- Show Raghav a clear badge: "AI unavailable: rule-engine fallback". He still reviews it like any other decision.
- Fallback decisions are **excluded** from the Kill 1 count (config: `exclude_ai_fallback_decisions`), because they are not AI decisions.
- If more than 30% of a run's decisions are fallbacks, show a run-level warning to Raghav and Deepa.

## Logging (for audit, never for secrets)
Store per decision: model name, prompt version, input JSON, raw response, validator result, latency. Never log the API key or request headers.

## Prompt versioning
Prompts live in `prompts/` with a version header. Any prompt change bumps `prompt_version` and is stored on each decision. Changing a prompt does not rewrite past decisions.
