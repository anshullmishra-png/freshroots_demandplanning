import { sql } from "drizzle-orm";
import { beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import type { AnyDb } from "@/db/snapshots";
import { authenticate } from "@/lib/auth/login";
import { loadRules } from "@/lib/config/rules";
import { TEST_PASSWORD, count, createTestDb, seedTestUsers, type TestUsers } from "../helpers/workflow";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));

import { POST as loginRoute } from "@/app/api/auth/login/route";

let db: AnyDb;
let u: TestUsers;
const limits = loadRules().login_protection;
const email = () => u.raghav.email;

beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
});
beforeEach(async () => {
  await db.execute(sql`TRUNCATE login_attempts RESTART IDENTITY`);
});

const wrong = (e = email(), ip: string | null = "10.0.0.1") => authenticate(db, e, "not-the-password", { ip });
const right = (e = email(), ip: string | null = "10.0.0.1") => authenticate(db, e, TEST_PASSWORD, { ip });
const failMany = async (n: number, e = email(), ip: string | null = "10.0.0.1") => {
  for (let i = 0; i < n; i++) await expect(wrong(e, ip)).rejects.toMatchObject({ status: 401 });
};
/** Moves every recorded attempt back in time, as if it had happened that many minutes ago. */
const age = (minutes: number) => db.execute(sql`UPDATE login_attempts SET at = at - make_interval(mins => ${minutes}::int)`);

describe("the limits come from config", () => {
  it("are the documented defaults", () => {
    expect(limits).toEqual({ max_failed_per_email: 5, max_failed_per_ip: 20, window_minutes: 15 });
  });
});

describe("failures for one email", () => {
  it("the first 5 wrong passwords are an ordinary 401, the 6th attempt is a 429 with a wait time", async () => {
    await failMany(5);
    await expect(wrong()).rejects.toMatchObject({ status: 429, code: "TOO_MANY_ATTEMPTS" });
    const err = await wrong().catch((e) => e);
    expect(err.details.retryAfterSeconds).toBeGreaterThan(14 * 60);
    expect(err.details.retryAfterSeconds).toBeLessThanOrEqual(15 * 60);
    expect(err.message).toMatch(/Try again in 15 minutes/);
  });

  it("4 failures do not lock it, and a right password after them signs in", async () => {
    await failMany(4);
    await expect(right()).resolves.toMatchObject({ id: u.raghav.id });
  });

  it("while locked even the right password is refused, and no password is checked", async () => {
    await failMany(5);
    await expect(right()).rejects.toMatchObject({ status: 429 });
  });

  it("refused attempts are not recorded, so hammering does not extend the lock", async () => {
    await failMany(5);
    for (let i = 0; i < 10; i++) await wrong().catch(() => {});
    expect(await count(db, "login_attempts")).toBe(5);
  });

  it("the lock ends when the failures age out of the window", async () => {
    await failMany(5);
    await age(14);
    await expect(right()).rejects.toMatchObject({ status: 429 });
    await age(2); // now 16 minutes old
    await expect(right()).resolves.toMatchObject({ id: u.raghav.id });
  });

  it("sliding: one old failure ages out first, freeing exactly one attempt", async () => {
    await failMany(2);
    await age(10);
    await failMany(3); // 2 failures are 10 minutes old, 3 are new: 5 in window, locked
    await expect(wrong()).rejects.toMatchObject({ status: 429 });
    await age(6); // the first two are 16 minutes old and drop out: 3 left
    await expect(wrong()).rejects.toMatchObject({ status: 401 });
  });

  it("a successful sign-in clears that email's earlier failures", async () => {
    await failMany(4);
    await right();
    await failMany(4); // would be 8 without the reset
    await expect(right()).resolves.toMatchObject({ id: u.raghav.id });
  });

  it("is per email: another account is unaffected, and letter case or spaces do not dodge the limit", async () => {
    await failMany(5);
    await expect(right(u.procurement.email)).resolves.toMatchObject({ id: u.procurement.id });
    await expect(right(`  ${email().toUpperCase()}  `)).rejects.toMatchObject({ status: 429 });
  });

  it("an email that does not exist is limited the same way, so the lock does not reveal which accounts exist", async () => {
    const ghost = "nobody@freshroots.test";
    await failMany(5, ghost);
    await expect(wrong(ghost)).rejects.toMatchObject({ status: 429 });
  });

  it("a deactivated account counts as a failure", async () => {
    await db.execute(sql`UPDATE users SET active = false WHERE id = ${u.deepa.id}`);
    try {
      await expect(right(u.deepa.email)).rejects.toMatchObject({ status: 401 });
      expect(await count(db, "login_attempts")).toBe(1);
    } finally {
      await db.execute(sql`UPDATE users SET active = true WHERE id = ${u.deepa.id}`);
    }
  });

  it("missing or empty fields are a plain 401 and are not recorded", async () => {
    await expect(authenticate(db, "", "x", { ip: "10.0.0.1" })).rejects.toMatchObject({ status: 401 });
    await expect(authenticate(db, undefined, undefined, { ip: "10.0.0.1" })).rejects.toMatchObject({ status: 401 });
    expect(await count(db, "login_attempts")).toBe(0);
  });

  it("a very long email is cut for storage but still limited", async () => {
    const long = `${"a".repeat(400)}@x.test`;
    await failMany(5, long);
    await expect(wrong(long)).rejects.toMatchObject({ status: 429 });
    const res = await db.execute(sql`SELECT max(length(email_key))::int AS n FROM login_attempts`);
    expect((res.rows[0] as { n: number }).n).toBe(200);
  });
});

describe("failures from one address", () => {
  it("20 failures across different emails lock that address, and a 21st attempt is a 429", async () => {
    for (let i = 0; i < 20; i++) await expect(wrong(`user${i}@freshroots.test`, "203.0.113.9")).rejects.toMatchObject({ status: 401 });
    await expect(wrong("fresh@freshroots.test", "203.0.113.9")).rejects.toMatchObject({ status: 429 });
    await expect(right(email(), "203.0.113.9")).rejects.toMatchObject({ status: 429 });
  });

  it("another address is unaffected", async () => {
    for (let i = 0; i < 20; i++) await wrong(`user${i}@freshroots.test`, "203.0.113.9").catch(() => {});
    await expect(right(email(), "198.51.100.4")).resolves.toMatchObject({ id: u.raghav.id });
  });

  it("a success does not clear an address's failures (only time does)", async () => {
    for (let i = 0; i < 20; i++) await wrong(`user${i}@freshroots.test`, "203.0.113.9").catch(() => {});
    await age(16);
    await expect(right(email(), "203.0.113.9")).resolves.toMatchObject({ id: u.raghav.id });
  });

  it("with no address known only the per-email limit applies", async () => {
    await failMany(3, email(), null);
    await expect(right(email(), null)).resolves.toMatchObject({ id: u.raghav.id });
  });
});

describe("custom limits are honoured (nothing is hard-coded)", () => {
  it("max 2 per email, 1 minute window", async () => {
    const tight = { max_failed_per_email: 2, max_failed_per_ip: 20, window_minutes: 1 };
    for (let i = 0; i < 2; i++) await authenticate(db, email(), "no", { ip: "10.0.0.1", limits: tight }).catch(() => {});
    await expect(authenticate(db, email(), TEST_PASSWORD, { ip: "10.0.0.1", limits: tight })).rejects.toMatchObject({ status: 429 });
    const err = await authenticate(db, email(), "no", { ip: "10.0.0.1", limits: tight }).catch((e) => e);
    expect(err.details.retryAfterSeconds).toBeLessThanOrEqual(60);
  });
});

describe("the sign-in route", () => {
  const post = (body: unknown, headers: Record<string, string> = {}) =>
    loginRoute(new Request("http://localhost/api/auth/login", { method: "POST", headers: { host: "localhost", "content-type": "application/json", ...headers }, body: JSON.stringify(body) }));

  it("answers 429 with a Retry-After header and never sets a cookie", async () => {
    for (let i = 0; i < 5; i++) expect((await post({ email: email(), password: "no" })).status).toBe(401);
    const res = await post({ email: email(), password: TEST_PASSWORD });
    expect(res.status).toBe(429);
    expect(Number(res.headers.get("retry-after"))).toBeGreaterThan(0);
    expect(res.headers.get("set-cookie")).toBeNull();
    expect((await res.json()).error.code).toBe("TOO_MANY_ATTEMPTS");
  });

  it("counts the address the host reports, not one the caller makes up in the body", async () => {
    for (let i = 0; i < 20; i++) await post({ email: `u${i}@freshroots.test`, password: "no" }, { "x-real-ip": "203.0.113.50" });
    expect((await post({ email: email(), password: TEST_PASSWORD }, { "x-real-ip": "203.0.113.50" })).status).toBe(429);
    expect((await post({ email: email(), password: TEST_PASSWORD }, { "x-real-ip": "203.0.113.51" })).status).toBe(200);
  });

  it("the first address in x-forwarded-for is used when x-real-ip is absent", async () => {
    for (let i = 0; i < 20; i++) await post({ email: `u${i}@freshroots.test`, password: "no" }, { "x-forwarded-for": "203.0.113.60, 10.1.1.1" });
    expect((await post({ email: email(), password: TEST_PASSWORD }, { "x-forwarded-for": "203.0.113.60, 10.9.9.9" })).status).toBe(429);
  });

  it("never stores the password", async () => {
    await post({ email: email(), password: "super-secret-guess-9" });
    const rows = await db.execute(sql`SELECT * FROM login_attempts`);
    expect(JSON.stringify(rows.rows)).not.toContain("super-secret-guess-9");
  });
});
