import { getAiRuntime } from "@/lib/ai/factory";
import { guarded } from "@/lib/api/http";
import { readUpload } from "@/lib/api/uploads";
import { loadRules } from "@/lib/config/rules";
import { resolveFiles, startRun } from "@/lib/workflow/startRun";

// Raghav starts a run: validate, store the snapshot, flag, and get the AI decisions. Always re-validated here.
export const POST = guarded("start_run", async ({ req, db, user }) => {
  const rules = loadRules();
  const upload = await readUpload(req);
  const files = await resolveFiles(db, upload.files, upload.usePreviousMasters);
  const run = await startRun(db, user, {
    files,
    acknowledgeWarnings: upload.acknowledgeWarnings,
    rules,
    ai: getAiRuntime(rules),
  });
  return Response.json(run, { status: 201 });
});
