import { getAiRuntime } from "@/lib/ai/factory";
import { guarded, paramId } from "@/lib/api/http";
import { loadRules } from "@/lib/config/rules";
import { continueRun } from "@/lib/workflow/startRun";

// One run's AI step can take longer than one request. This picks up where it stopped: it makes the decisions that are
// still missing, within a time budget, and reports how many remain. The New Run screen calls it until nothing remains.
export const maxDuration = 300;

export const POST = guarded("start_run", async ({ db, user }, params) => {
  const rules = loadRules();
  return continueRun(db, user, await paramId(params), { rules, ai: getAiRuntime(rules) });
});
