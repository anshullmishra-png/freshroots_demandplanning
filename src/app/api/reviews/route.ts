import { guarded, readJson } from "@/lib/api/http";
import { parseReviewRequest, reviewDecision } from "@/lib/workflow/review";

// One accept or reject. Only the raghav role (or an audited admin) passes the permission check.
export const POST = guarded("review", async ({ req, db, user }) => {
  const request = parseReviewRequest(await readJson(req));
  return reviewDecision(db, user, request);
});
