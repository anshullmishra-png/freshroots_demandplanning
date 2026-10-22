/** The JSON schema sent to Gemini as the response format. The validator enforces the same rules again in code. */
export const RESPONSE_SCHEMA = {
  type: "object",
  properties: {
    sku_id: { type: "string" },
    action: { type: "string", enum: ["REORDER", "PAUSE_ORDER"] },
    quantity: { type: "integer", minimum: 0 },
    explanation: { type: "string" },
    confidence: { type: "string", enum: ["LOW", "MEDIUM", "HIGH"] },
    needs_judgment: { type: "boolean" },
    judgment_note: { anyOf: [{ type: "string" }, { type: "null" }] },
  },
  required: ["sku_id", "action", "quantity", "explanation", "confidence", "needs_judgment", "judgment_note"],
  additionalProperties: false,
} as const;

export const OUTPUT_KEYS = Object.keys(RESPONSE_SCHEMA.properties).sort();

export const EXPLANATION_MIN = 40;
export const EXPLANATION_MAX = 450;
export const JUDGMENT_NOTE_MAX = 200;
