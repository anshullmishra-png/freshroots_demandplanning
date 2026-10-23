import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api/http";
import { assertCronSecret } from "@/lib/auth/cron";
import { deepHealth } from "@/lib/env/health";

// For the deploy check and for monitoring. Needs the same secret as the cron job. Returns facts about the setup
// (what is present, what is missing), never a value. 200 when ready to serve, 503 when not.
export async function GET(req: Request) {
  try {
    assertCronSecret(req);
    const health = await deepHealth(getDb());
    return Response.json(health, { status: health.ok ? 200 : 503, headers: { "Cache-Control": "no-store" } });
  } catch (e) {
    return errorResponse(e);
  }
}
