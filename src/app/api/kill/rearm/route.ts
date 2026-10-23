import { guarded, readJson } from "@/lib/api/http";
import { rearmKill } from "@/lib/kill/service";

// Only Deepa or the CEO, with a written reason (G-K3).
export const POST = guarded("rearm_kill", async ({ req, db, user }) => {
  const body = (await readJson(req)) as { which?: unknown; reason?: unknown; confirmRefire?: unknown } | null;
  return rearmKill(db, user, { which: body?.which, reason: body?.reason, confirmRefire: body?.confirmRefire });
});
