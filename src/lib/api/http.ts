import { getDb } from "@/db/client";
import type { AnyDb } from "@/db/snapshots";
import { redactSecrets } from "@/lib/ai/client";
import { assertCan, type Permission } from "@/lib/auth/permissions";
import { userForRequest, type SessionUser } from "@/lib/auth/session";
import { AppError, badRequest, forbidden, unauthorized } from "@/lib/errors";

export interface Ctx {
  req: Request;
  db: AnyDb;
  user: SessionUser;
}
export type RouteParams = { params: Promise<Record<string, string>> };

/**
 * Next.js and React use thrown values for control flow (a route being dynamic, redirects, postponing a render).
 * They carry a `digest` or a React `$$typeof` marker and must reach the framework, never become a 500.
 */
function isFrameworkSignal(e: unknown): boolean {
  return typeof e === "object" && e !== null && ("digest" in e || "$$typeof" in e);
}

export function errorResponse(e: unknown): Response {
  if (isFrameworkSignal(e)) throw e;
  if (e instanceof AppError) {
    const wait = (e.details as { retryAfterSeconds?: unknown } | undefined)?.retryAfterSeconds;
    const headers = e.status === 429 && typeof wait === "number" ? { "Retry-After": String(wait) } : undefined;
    return Response.json({ error: { code: e.code, message: e.message, details: e.details } }, { status: e.status, headers });
  }
  // Never leak internals or secrets to the caller or the logs (G-S2).
  const message = redactSecrets(e instanceof Error ? e.message : String(e)).slice(0, 300);
  console.error(`[api] unexpected error: ${message}`);
  return Response.json({ error: { code: "INTERNAL", message: "Something went wrong." } }, { status: 500 });
}

/** A state-changing request must come from this site (defence in depth on top of sameSite=lax cookies). */
function assertSameOrigin(req: Request): void {
  if (req.method === "GET" || req.method === "HEAD") return;
  const origin = req.headers.get("origin");
  if (origin && new URL(origin).host !== req.headers.get("host")) throw forbidden("Cross-site request refused.");
}

/**
 * Wraps a route handler: signed-in user required (401), role must hold the permission (403), same-origin
 * for writes. The check runs on the server for every API route (guardrail G-S3).
 */
export function guarded(
  permission: Permission,
  fn: (ctx: Ctx, params: RouteParams | undefined) => Promise<Response | object>,
) {
  return async (req: Request, params?: RouteParams): Promise<Response> => {
    try {
      assertSameOrigin(req);
      const db = getDb();
      const user = await userForRequest(db, req);
      if (!user) throw unauthorized();
      assertCan(user.role, permission);
      const out = await fn({ req, db, user }, params);
      return out instanceof Response ? out : Response.json(out);
    } catch (e) {
      return errorResponse(e);
    }
  };
}

export async function readJson(req: Request): Promise<unknown> {
  try {
    return await req.json();
  } catch {
    throw badRequest("BAD_JSON", "The request body must be JSON.");
  }
}

export async function paramId(params: RouteParams | undefined, name = "id"): Promise<number> {
  const raw = (await params?.params)?.[name];
  const id = Number(raw);
  if (!Number.isInteger(id) || id <= 0) throw badRequest("BAD_ID", `${name} must be a positive whole number.`);
  return id;
}
