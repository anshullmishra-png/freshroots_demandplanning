// One real Gemini call on one seed flag, through the same decision step the app uses.
//   npm run ai:smoke              decides SKU001 (the default)
//   npm run ai:smoke -- SKU006    decides another flagged seed SKU
// Needs GEMINI_API_KEY and GEMINI_MODEL in .env.local. Prints the decision, never the key.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRules } from "@/lib/config/rules";
import { decideFlag, resolveModel } from "@/lib/ai/decide";
import { createGeminiClient } from "@/lib/ai/gemini";
import { buildAiInput } from "@/lib/ai/input";
import { loadPrompts } from "@/lib/ai/prompts";
import { runRuleEngine } from "@/lib/rules/engine";
import { validateUpload } from "@/lib/validation/validate";
import { FILE_KEYS, FILE_NAMES, type FileKey } from "@/lib/validation/types";

config({ path: ".env.local", quiet: true });

async function main() {
  const skuId = process.argv[2] ?? "SKU001";
  const rules = loadRules();
  const files = {} as Record<FileKey, string>;
  for (const key of FILE_KEYS) files[key] = readFileSync(path.resolve("seed", FILE_NAMES[key]), "utf8");
  const v = validateUpload(files, { rules, now: new Date("2026-10-19T12:00:00+05:30") });
  if (!v.ok) throw new Error("seed did not validate");
  const run = runRuleEngine(v.data!, rules);
  const flag = run.flags.find((f) => f.sku_id === skuId);
  if (!flag) throw new Error(`${skuId} is not flagged on the seed. Flagged: ${run.flags.map((f) => f.sku_id).join(", ")}`);
  const sku = v.data!.skus.find((s) => s.sku_id === skuId)!;

  const model = resolveModel(rules);
  const input = buildAiInput(flag, sku, run, rules);
  console.log(`Model: ${model}`);
  console.log(`Rule engine: ${flag.flag_types.join(" + ")} -> ${flag.rule_action} ${flag.rule_qty}`);

  const decision = await decideFlag(createGeminiClient(), input, {
    model,
    prompts: loadPrompts(),
    rules,
    validator: {
      allSkus: v.data!.skus.map((s) => ({ sku_id: s.sku_id, name: s.name })),
      windowWeeks: [rules.rules.recent_window_weeks, rules.rules.average_window_weeks],
    },
  });

  console.log(`Attempts: ${decision.attempts.map((a) => `${a.outcome} (${a.latency_ms} ms)`).join(", ")}`);
  console.log(`Result: ${decision.is_fallback ? "FALLBACK (rule engine used)" : "valid AI decision"}`);
  console.log(`Decision: ${decision.action} ${decision.quantity}, confidence ${decision.confidence}, needs_judgment ${decision.needs_judgment}`);
  console.log(`Explanation: ${decision.explanation}`);
  if (decision.judgment_note) console.log(`Judgment note: ${decision.judgment_note}`);
  if (decision.invalid_reasons.length) console.log(`Problems: ${decision.invalid_reasons.join(" | ")}`);
  for (const a of decision.attempts.filter((x) => x.outcome !== "valid")) {
    console.log(`  attempt ${a.attempt} ${a.outcome}: ${a.errors.join(" | ")}`);
    if (a.raw_response) console.log(`  raw: ${a.raw_response.slice(0, 400)}`);
  }
  if (decision.is_fallback) process.exitCode = 1;
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
