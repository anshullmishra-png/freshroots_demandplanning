import { guarded, readJson } from "@/lib/api/http";
import { bulkAccept } from "@/lib/workflow/review";

export const POST = guarded("review", async ({ req, db, user }) => {
  const body = (await readJson(req)) as { aiDecisionIds?: unknown } | null;
  const results = await bulkAccept(db, user, body?.aiDecisionIds);
  return { accepted: results.length, results };
});
