import { getDb } from "@/db/client";
import { errorResponse, readJson } from "@/lib/api/http";
import { authenticate } from "@/lib/auth/login";
import { homeFor } from "@/lib/auth/permissions";
import { createSessionToken, sessionCookie } from "@/lib/auth/session";
import { badRequest } from "@/lib/errors";

export async function POST(req: Request) {
  try {
    const body = (await readJson(req)) as { email?: unknown; password?: unknown } | null;
    if (!body || typeof body !== "object") throw badRequest("BAD_BODY", "Send email and password.");
    const user = await authenticate(getDb(), body.email, body.password);
    const token = await createSessionToken(user.id);
    return Response.json(
      { user: { name: user.name, role: user.role }, home: homeFor(user.role) },
      { headers: { "Set-Cookie": sessionCookie(token) } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
