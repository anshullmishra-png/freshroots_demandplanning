// Creates a run from the seed data, through the same code the app uses (store snapshot, flag, AI decisions).
//
//   npm run seed:run                       real Gemini (needs GEMINI_API_KEY and GEMINI_MODEL in .env.local)
//   AI_CLIENT=mock npm run seed:run        the scripted mock AI, no API key needed
//
// "Today" is pinned to the seed's as-of date so the 7-day freshness rule does not block old seed data.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { sql } from "drizzle-orm";
import { storeSnapshot } from "@/db/snapshots";
import { getAiRuntime } from "@/lib/ai/factory";
import { loadRules } from "@/lib/config/rules";
import { validateUpload } from "@/lib/validation/validate";
import { FILE_KEYS, FILE_NAMES, type FileKey } from "@/lib/validation/types";
import { createRun } from "@/lib/workflow/runs";

config({ path: ".env.local", quiet: true });

async function main() {
  const rules = loadRules();
  const files = {} as Record<FileKey, string>;
  for (const key of FILE_KEYS) files[key] = readFileSync(path.resolve("seed", FILE_NAMES[key]), "utf8");
  const result = validateUpload(files, { rules, now: new Date("2026-10-19T12:00:00+05:30") });
  if (!result.ok) throw new Error("The seed did not validate.");

  const { getDb, closeDb } = await import("@/db/client");
  const db = getDb();
  try {
    const [raghav] = (await db.execute(sql`select id from users where role = 'raghav' and active order by id limit 1`)).rows as Array<{ id: number }>;
    const { snapshotId } = await storeSnapshot(db, { uploadedBy: raghav?.id ?? null, files, result });
    const ai = getAiRuntime(rules);
    console.log(`Snapshot #${snapshotId} stored. Creating the run with model ${ai.model}...`);
    const run = await createRun(db, { snapshotId, createdBy: raghav?.id ?? null, rules, client: ai.client, model: ai.model, prompts: ai.prompts });
    console.log(`Run #${run.runId}: ${run.flagCount} flags, ${run.fallbackCount} fallback(s), status ${run.status}.`);
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
