import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api/http";
import { assertCronSecret } from "@/lib/auth/cron";
import { deliverAfterCommit } from "@/lib/email";
import { evaluateKill2AndAct } from "@/lib/kill/service";

// Daily check in case a quarter rolled over or an entry was edited (docs/06, "When to evaluate"). Vercel Cron calls it.
export async function GET(req: Request) {
  try {
    assertCronSecret(req);
    const db = getDb();
    const outcome = await evaluateKill2AndAct(db);
    await deliverAfterCommit(db);
    return Response.json({ state: outcome.state, changed: outcome.changed, total: outcome.total });
  } catch (e) {
    return errorResponse(e);
  }
}
