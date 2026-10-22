import { eq } from "drizzle-orm";
import { SignJWT, jwtVerify } from "jose";
import type { AnyDb } from "@/db/snapshots";
import { users } from "@/db/schema";
import type { Role } from "./permissions";

export const SESSION_COOKIE = "fr_session";
export const SESSION_MAX_AGE_SECONDS = 8 * 60 * 60;

export interface SessionUser {
  id: number;
  name: string;
  email: string;
  role: Role;
}

function secretKey(env: NodeJS.ProcessEnv = process.env): Uint8Array {
  const secret = env.AUTH_SECRET;
  if (!secret || secret.length < 32) {
    throw new Error("AUTH_SECRET is missing or shorter than 32 characters. Set it in .env.local (see .env.example).");
  }
  return new TextEncoder().encode(secret);
}

/** A signed token that only says who the user is. Their role and active flag are re-read from the database on every request. */
export async function createSessionToken(userId: number): Promise<string> {
  return new SignJWT({})
    .setProtectedHeader({ alg: "HS256" })
    .setSubject(String(userId))
    .setIssuedAt()
    .setExpirationTime(`${SESSION_MAX_AGE_SECONDS}s`)
    .sign(secretKey());
}

export async function verifySessionToken(token: string | undefined | null): Promise<number | null> {
  if (!token) return null;
  try {
    const { payload } = await jwtVerify(token, secretKey(), { algorithms: ["HS256"] });
    const id = Number(payload.sub);
    return Number.isInteger(id) && id > 0 ? id : null;
  } catch {
    return null; // bad signature, expired, or malformed: treat as signed out
  }
}

export function parseCookies(header: string | null | undefined): Record<string, string> {
  const out: Record<string, string> = {};
  for (const part of (header ?? "").split(";")) {
    const i = part.indexOf("=");
    if (i > 0) out[part.slice(0, i).trim()] = decodeURIComponent(part.slice(i + 1).trim());
  }
  return out;
}

/** httpOnly, sameSite=lax, and secure in production (guardrail G-S6). */
export function sessionCookie(token: string, env: NodeJS.ProcessEnv = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${SESSION_MAX_AGE_SECONDS}${secure}`;
}

export function clearedSessionCookie(env: NodeJS.ProcessEnv = process.env): string {
  const secure = env.NODE_ENV === "production" ? "; Secure" : "";
  return `${SESSION_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0${secure}`;
}

/** The signed-in user for a token, or null. A deactivated account is signed out at once. */
export async function userForToken(db: AnyDb, token: string | undefined | null): Promise<SessionUser | null> {
  const id = await verifySessionToken(token);
  if (id === null) return null;
  const [u] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active })
    .from(users)
    .where(eq(users.id, id))
    .limit(1);
  if (!u || !u.active) return null;
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}

export async function userForRequest(db: AnyDb, req: Request): Promise<SessionUser | null> {
  return userForToken(db, parseCookies(req.headers.get("cookie"))[SESSION_COOKIE]);
}
