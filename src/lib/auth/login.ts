import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { AppError } from "@/lib/errors";
import { verifyPassword } from "./password";
import type { SessionUser } from "./session";

/** Email and password to a user, or a generic 401. The message never says which of the two was wrong. */
export async function authenticate(db: AnyDb, email: unknown, password: unknown): Promise<SessionUser> {
  const fail = () => new AppError(401, "BAD_LOGIN", "Email or password is wrong.");
  if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") throw fail();

  const [u] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  const ok = await verifyPassword(password, u?.passwordHash ?? null);
  if (!u || !ok || !u.active) throw fail();
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
