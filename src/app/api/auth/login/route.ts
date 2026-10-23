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
    // Vercel sets these headers itself, so the caller cannot choose the address that is counted.
    const ip = req.headers.get("x-real-ip") ?? req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() ?? null;
    const user = await authenticate(getDb(), body.email, body.password, { ip: ip || null });
    const token = await createSessionToken(user.id);
    return Response.json(
      { user: { name: user.name, role: user.role }, home: homeFor(user.role) },
      { headers: { "Set-Cookie": sessionCookie(token) } },
    );
  } catch (e) {
    return errorResponse(e);
  }
}
