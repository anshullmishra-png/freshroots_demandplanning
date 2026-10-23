import { sql } from "drizzle-orm";
import { loginAttempts, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { AppError } from "@/lib/errors";
import { verifyPassword } from "./password";
import type { SessionUser } from "./session";

type Limits = RulesConfig["login_protection"];
export interface LoginContext {
  /** The caller's address as the host reports it; null when unknown (the per-address limit is then skipped). */
  ip?: string | null;
  limits?: Limits;
}

const emailKey = (email: string) => email.trim().toLowerCase().slice(0, 200);

/**
 * Failures that still count, oldest first: inside the window and after the last success. A successful sign-in
 * clears an email's failures; an address's failures only age out.
 */
async function failureTimes(db: AnyDb, by: { email: string } | { ip: string }, limits: Limits): Promise<Date[]> {
  const window = sql`now() - make_interval(mins => ${limits.window_minutes}::int)`;
  const scope = "email" in by ? sql`email_key = ${by.email}` : sql`ip = ${by.ip}`;
  const afterLastSuccess =
    "email" in by
      ? sql`AND at > coalesce((SELECT max(at) FROM login_attempts WHERE email_key = ${by.email} AND succeeded), '-infinity')`
      : sql``;
  const res = await db.execute(
    sql`SELECT at FROM login_attempts WHERE ${scope} AND NOT succeeded AND at > ${window} ${afterLastSuccess} ORDER BY at ASC`,
  );
  return res.rows.map((r: unknown) => new Date((r as { at: string | Date }).at));
}

/** Seconds until enough failures age out for one more attempt, or 0 when attempts are allowed. */
function secondsLocked(times: Date[], max: number, limits: Limits): number {
  if (times.length < max) return 0;
  const frees = times[times.length - max].getTime() + limits.window_minutes * 60_000;
  return Math.max(1, Math.ceil((frees - Date.now()) / 1000));
}

async function assertNotLocked(db: AnyDb, email: string, ip: string | null, limits: Limits): Promise<void> {
  const byEmail = secondsLocked(await failureTimes(db, { email }, limits), limits.max_failed_per_email, limits);
  const byIp = ip ? secondsLocked(await failureTimes(db, { ip }, limits), limits.max_failed_per_ip, limits) : 0;
  const wait = Math.max(byEmail, byIp);
  if (wait > 0) {
    const minutes = Math.ceil(wait / 60);
    throw new AppError(
      429,
      "TOO_MANY_ATTEMPTS",
      `Too many failed sign-in attempts. Try again in ${minutes} minute${minutes === 1 ? "" : "s"}.`,
      { retryAfterSeconds: wait },
    );
  }
}

/**
 * Email and password to a user, or a generic 401. The message never says which of the two was wrong. After too many
 * failures for one email (or from one address) further attempts are refused with 429 before any password is checked,
 * so a correct guess during the lock does not get in either. Refused attempts are not recorded, so the lock ends on time.
 */
export async function authenticate(
  db: AnyDb,
  email: unknown,
  password: unknown,
  ctx: LoginContext = {},
): Promise<SessionUser> {
  const fail = () => new AppError(401, "BAD_LOGIN", "Email or password is wrong.");
  const limits = ctx.limits ?? loadRules().login_protection;
  const ip = ctx.ip ?? null;
  if (typeof email !== "string" || typeof password !== "string" || email === "" || password === "") throw fail();
  const key = emailKey(email);

  await assertNotLocked(db, key, ip, limits);

  const [u] = await db
    .select()
    .from(users)
    .where(sql`lower(${users.email}) = ${email.trim().toLowerCase()}`)
    .limit(1);
  const ok = await verifyPassword(password, u?.passwordHash ?? null);
  const success = !!u && ok && u.active;
  await db.insert(loginAttempts).values({ emailKey: key, ip, succeeded: success });
  if (!success) throw fail();

  // Housekeeping: attempts older than a month are of no use.
  await db.execute(sql`DELETE FROM login_attempts WHERE at < now() - interval '30 days'`);
  return { id: u.id, name: u.name, email: u.email, role: u.role };
}
