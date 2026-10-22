import { guarded } from "@/lib/api/http";
import { readUpload } from "@/lib/api/uploads";
import { loadRules } from "@/lib/config/rules";
import { resolveFiles, validateFiles } from "@/lib/workflow/startRun";

// Dry run for the New Run page: returns the validation report and stores nothing.
export const POST = guarded("upload_data", async ({ req, db }) => {
  const upload = await readUpload(req);
  const files = await resolveFiles(db, upload.files, upload.usePreviousMasters);
  const result = validateFiles(files, loadRules());
  return { ok: result.ok, errors: result.errors, warnings: result.warnings, fileStats: result.fileStats };
});
