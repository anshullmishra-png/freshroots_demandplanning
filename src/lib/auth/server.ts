import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { getDb } from "@/db/client";
import { can, type Permission } from "./permissions";
import { SESSION_COOKIE, userForToken, type SessionUser } from "./session";

/** The signed-in user for this page request, or null. Must be called inside a <Suspense> boundary (it reads cookies). */
export async function getCurrentUser(): Promise<SessionUser | null> {
  const jar = await cookies();
  return userForToken(getDb(), jar.get(SESSION_COOKIE)?.value);
}

/**
 * Server-side page guard (guardrail G-S3): not signed in goes to /login; signed in without the permission goes to
 * /forbidden. Hiding a button is never the only protection; the API checks the same permission again.
 */
export async function requireUser(permission?: Permission): Promise<SessionUser> {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  if (permission && !can(user.role, permission)) redirect("/forbidden");
  return user;
}
