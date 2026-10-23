import { getAiRuntime } from "@/lib/ai/factory";
import { guarded } from "@/lib/api/http";
import { readUpload } from "@/lib/api/uploads";
import { loadRules } from "@/lib/config/rules";
import { resolveFiles, startRun } from "@/lib/workflow/startRun";

// Raghav starts a run: validate, store the snapshot, flag, and get the AI decisions. Always re-validated here.
// The AI step works within a time budget (150 s) inside Vercel's 300 s limit; if it is not finished the response says how
// many decisions remain and the New Run screen asks for the rest at /api/runs/[id]/continue.
export const maxDuration = 300;

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
