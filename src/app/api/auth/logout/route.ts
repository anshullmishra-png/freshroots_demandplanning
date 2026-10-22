import { clearedSessionCookie } from "@/lib/auth/session";

export async function POST() {
  return Response.json({ ok: true }, { headers: { "Set-Cookie": clearedSessionCookie() } });
}
