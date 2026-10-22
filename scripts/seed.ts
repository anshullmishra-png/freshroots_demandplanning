// Loads the five seed CSVs through the same validation as a real upload.
//
//   npm run seed -- --dry-run --now=2026-10-19   validate only, print the report, touch no database
//   npm run seed -- --now=2026-10-19              validate, then store a snapshot in the database
//
// --now pins "today" for the freshness check. The seed data is as of 2026-10-19, so without it the
// run is blocked once that date is more than 7 days old (this is the stale-inventory rule working).
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import path from "node:path";
import { loadRules } from "@/lib/config/rules";
import { validateUpload } from "@/lib/validation/validate";
import { FILE_KEYS, FILE_NAMES, type FileKey } from "@/lib/validation/types";

config({ path: ".env.local", quiet: true });

function arg(name: string): string | undefined {
  const hit = process.argv.find((a) => a.startsWith(`--${name}=`));
  return hit?.slice(name.length + 3);
}

async function main() {
  const dryRun = process.argv.includes("--dry-run");
  const nowArg = arg("now");
  const now = nowArg ? new Date(`${nowArg}T12:00:00+05:30`) : new Date();
  if (Number.isNaN(now.getTime())) throw new Error(`--now must be YYYY-MM-DD, got "${nowArg}"`);

  const files = {} as Record<FileKey, string>;
  for (const key of FILE_KEYS) {
    files[key] = readFileSync(path.resolve("seed", FILE_NAMES[key]), "utf8");
  }

  const result = validateUpload(files, { rules: loadRules(), now });
  console.log(`Rows read: ${FILE_KEYS.map((k) => `${FILE_NAMES[k]}=${result.fileStats[k] ?? "unreadable"}`).join(", ")}`);
  for (const issue of [...result.errors, ...result.warnings]) {
    const where = issue.row ? `${FILE_NAMES[issue.file]} line ${issue.row}` : FILE_NAMES[issue.file];
    console.log(`${issue.level} [${issue.code}] ${where}: ${issue.message}`);
  }
  console.log(`${result.errors.length} error(s), ${result.warnings.length} warning(s).`);
  if (!result.ok) {
    console.error("Blocked: nothing was written.");
    process.exitCode = 1;
    return;
  }
  if (dryRun) {
    console.log(`Dry run OK. as_of_date ${result.data!.asOfDate}, last complete week ${result.data!.lastCompleteWeek}.`);
    return;
  }

  // Database modules are loaded only when we actually write, so --dry-run needs no database.
  const { getDb, closeDb } = await import("@/db/client");
  const { storeSnapshot } = await import("@/db/snapshots");
  try {
    const { snapshotId } = await storeSnapshot(getDb(), { uploadedBy: null, files, result });
    console.log(`Stored data snapshot #${snapshotId}.`);
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
