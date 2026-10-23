import { guarded, readJson } from "@/lib/api/http";
import { releaseHeld } from "@/lib/workflow/buying";

// Raghav's written confirmation that a held order may go ahead (open question 39).
export const POST = guarded("review", async ({ req, db, user }) => {
  const body = (await readJson(req)) as { ids?: unknown; reason?: unknown } | null;
  return releaseHeld(db, user, body?.ids, body?.reason);
});
