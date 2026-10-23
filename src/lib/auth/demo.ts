import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { isProduction } from "@/lib/env/check";
import { AppError, badRequest, notFound } from "@/lib/errors";
import { ROLES, type Role } from "./permissions";
import type { SessionUser } from "./session";

type Env = Record<string, string | undefined>;

/**
 * Open demo access: a shared link that signs the visitor in as a test account with no password, so a reviewer can look
 * around the whole app. It exists for a throwaway preview only. It needs DEMO_OPEN_ACCESS=1 and it can never switch on
 * for a Vercel production deployment, whatever the variable says. The accounts are the end-to-end test ones.
 */
export function demoEnabled(env: Env = process.env): boolean {
  return env.DEMO_OPEN_ACCESS === "1" && !isProduction(env);
}

export const demoEmail = (role: Role) => `${role}@e2e.freshroots.test`;

export function parseDemoRole(value: unknown): Role {
  if (typeof value !== "string" || !(ROLES as string[]).includes(value)) throw badRequest("BAD_ROLE", "Unknown role.");
  return value as Role;
}

/** The demo account for a role. A 404 (not a hint that the feature exists) when demo access is off. */
export async function demoUser(db: AnyDb, role: Role, env: Env = process.env): Promise<SessionUser> {
  if (!demoEnabled(env)) throw notFound();
  const [u] = await db
    .select({ id: users.id, name: users.name, email: users.email, role: users.role, active: users.active })
    .from(users)
    .where(sql`lower(${users.email}) = ${demoEmail(role)}`)
    .limit(1);
  if (!u || !u.active) throw new AppError(404, "NO_DEMO_ACCOUNT", "The demo account for this role does not exist.");
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
