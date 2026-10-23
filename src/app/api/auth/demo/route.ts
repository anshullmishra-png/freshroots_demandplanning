import { getDb } from "@/db/client";
import { errorResponse } from "@/lib/api/http";
import { demoUser, parseDemoRole } from "@/lib/auth/demo";
import { homeFor } from "@/lib/auth/permissions";
import { createSessionToken, sessionCookie } from "@/lib/auth/session";

// Open demo access (src/lib/auth/demo.ts): GET /api/auth/demo?role=raghav signs in as that role's test account and
// goes to its home page. Answers 404 unless DEMO_OPEN_ACCESS=1 on a non-production deployment.
export async function GET(req: Request) {
  try {
    const role = parseDemoRole(new URL(req.url).searchParams.get("role") ?? "raghav");
    const user = await demoUser(getDb(), role);
    const token = await createSessionToken(user.id);
    return new Response(null, { status: 303, headers: { Location: homeFor(user.role), "Set-Cookie": sessionCookie(token) } });
  } catch (e) {
    return errorResponse(e);
  }
}
