import type { AnyDb } from "@/db/snapshots";
import { latestMasterFiles, storeSnapshot } from "@/db/snapshots";
import type { AiRuntime } from "@/lib/ai/factory";
import { assertCan } from "@/lib/auth/permissions";
import type { SessionUser } from "@/lib/auth/session";
import type { RulesConfig } from "@/lib/config/rules";
import { AppError } from "@/lib/errors";
import { validateUpload } from "@/lib/validation/validate";
import { FILE_KEYS, type FileKey, type UploadFiles, type ValidationResult } from "@/lib/validation/types";
import { assertAutomationRunning } from "@/lib/kill/service";
import { writeAudit } from "./audit";
import { createRun, type CreatedRun } from "./runs";

const MASTER_KEYS: FileKey[] = ["sku_master", "distributor_master", "calendar"];

/** Fills missing master files from the previous upload when asked ("Use previous master files"). */
export async function resolveFiles(db: AnyDb, files: UploadFiles, usePreviousMasters: boolean): Promise<UploadFiles> {
  if (!usePreviousMasters) return files;
  const previous = await latestMasterFiles(db);
  const merged: UploadFiles = { ...files };
  for (const key of MASTER_KEYS) if (merged[key] === undefined) merged[key] = previous[key];
  return merged;
}

export function validateFiles(files: UploadFiles, rules: RulesConfig, now = new Date()): ValidationResult {
  return validateUpload(files, { rules, now });
}

/**
 * Upload, validate, store a snapshot, then flag and decide. Everything is re-validated on the server: an upload
 * with any error never gets past here (G-D1), and warnings must have been acknowledged (docs/03, ingestion flow).
 */
export async function startRun(
  db: AnyDb,
  actor: SessionUser,
  input: { files: UploadFiles; acknowledgeWarnings: boolean; rules: RulesConfig; ai: AiRuntime; now?: Date },
): Promise<CreatedRun & { snapshotId: number; warnings: number }> {
  assertCan(actor.role, "start_run");
  assertCan(actor.role, "upload_data");
  await assertAutomationRunning(db); // a stopped system takes no new runs (G-K2)

  const result = validateFiles(input.files, input.rules, input.now);
  if (!result.ok) {
    throw new AppError(422, "VALIDATION_FAILED", "The files have errors. Fix them and upload again.", {
      errors: result.errors,
      warnings: result.warnings,
    });
  }
  if (result.warnings.length > 0 && !input.acknowledgeWarnings) {
    throw new AppError(422, "WARNINGS_NOT_ACKNOWLEDGED", "Read the warnings and tick the box to continue.", {
      warnings: result.warnings,
    });
  }

  const files = {} as Record<FileKey, string>;
  for (const key of FILE_KEYS) files[key] = input.files[key]!;
  const { snapshotId } = await storeSnapshot(db, { uploadedBy: actor.id, files, result });
  await writeAudit(db, {
    actorId: actor.id,
    action: "snapshot.uploaded",
    entity: "data_snapshot",
    entityId: snapshotId,
    after: { as_of_date: result.data!.asOfDate, warnings: result.warnings.length },
  });

  const run = await createRun(db, {
    snapshotId,
    createdBy: actor.id,
    rules: input.rules,
    client: input.ai.client,
    model: input.ai.model,
    prompts: input.ai.prompts,
  });
  return { ...run, snapshotId, warnings: result.warnings.length };
}
