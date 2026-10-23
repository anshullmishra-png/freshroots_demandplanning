import { sql } from "drizzle-orm";
import { afterEach, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnyDb } from "@/db/snapshots";
import { demoEmail, demoEnabled, demoUser } from "@/lib/auth/demo";
import { ROLES } from "@/lib/auth/permissions";
import { userForRequest } from "@/lib/auth/session";
import { checkEnvironment } from "@/lib/env/check";
import { createTestDb, seedTestUsers, type TestUsers } from "../helpers/workflow";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));
import { GET as demoRoute } from "@/app/api/auth/demo/route";

let db: AnyDb;
let u: TestUsers;
beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
});
afterEach(() => vi.unstubAllEnvs());

const call = (role?: string) => demoRoute(new Request(`http://localhost/api/auth/demo${role === undefined ? "" : `?role=${role}`}`));

describe("when it is off (the default)", () => {
  it("is off with no setting, with 0, with anything but 1", () => {
    expect(demoEnabled({})).toBe(false);
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "0" })).toBe(false);
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "true" })).toBe(false);
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "" })).toBe(false);
  });

  it("the route is a 404, sets no cookie, and does not reveal that the feature exists", async () => {
    const res = await call("raghav");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
  });
});

describe("when it is on, on a preview", () => {
  it("is on only with exactly 1", () => {
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "1" })).toBe(true);
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "1", VERCEL_ENV: "preview" })).toBe(true);
  });

  it.each(ROLES)("signs in as the %s test account with no password and goes to that role's home", async (role) => {
    vi.stubEnv("DEMO_OPEN_ACCESS", "1");
    const res = await call(role);
    expect(res.status).toBe(303);
    const cookie = res.headers.get("set-cookie")!;
    expect(cookie).toContain("fr_session=");
    expect(cookie).toContain("HttpOnly");
    expect(res.headers.get("location")).toBe(role === "raghav" ? "/review" : role === "procurement" ? "/orders" : "/dashboard");
    // The cookie is a real session for that account and nobody else.
    const user = await userForRequest(db, new Request("http://localhost/", { headers: { cookie: cookie.split(";")[0] } }));
    expect(user).toMatchObject({ email: demoEmail(role), role });
  });

  it("defaults to Raghav, and refuses an unknown role", async () => {
    vi.stubEnv("DEMO_OPEN_ACCESS", "1");
    expect((await call()).headers.get("location")).toBe("/review");
    expect((await call("superuser")).status).toBe(400);
    expect((await call("RAGHAV")).status).toBe(400);
  });

  it("only ever signs in the shared test accounts, never a real-looking one", async () => {
    vi.stubEnv("DEMO_OPEN_ACCESS", "1");
    await db.execute(sql`UPDATE users SET email = 'raghav@company.example' WHERE id = ${u.raghav.id}`);
    try {
      expect((await call("raghav")).status).toBe(404); // no raghav@freshroots.test any more
    } finally {
      await db.execute(sql`UPDATE users SET email = 'raghav@freshroots.test' WHERE id = ${u.raghav.id}`);
    }
  });

  it("a deactivated demo account cannot be entered", async () => {
    vi.stubEnv("DEMO_OPEN_ACCESS", "1");
    await db.execute(sql`UPDATE users SET active = false WHERE id = ${u.ceo.id}`);
    try {
      expect((await call("ceo")).status).toBe(404);
    } finally {
      await db.execute(sql`UPDATE users SET active = true WHERE id = ${u.ceo.id}`);
    }
  });
});

describe("it can never work on production", () => {
  it("is off on production even when switched on", () => {
    expect(demoEnabled({ DEMO_OPEN_ACCESS: "1", VERCEL_ENV: "production" })).toBe(false);
  });

  it("the route is a 404 on production even when switched on", async () => {
    vi.stubEnv("DEMO_OPEN_ACCESS", "1");
    vi.stubEnv("VERCEL_ENV", "production");
    const res = await call("admin");
    expect(res.status).toBe(404);
    expect(res.headers.get("set-cookie")).toBeNull();
    await expect(demoUser(db, "admin", { DEMO_OPEN_ACCESS: "1", VERCEL_ENV: "production" })).rejects.toMatchObject({ status: 404 });
  });

  it("the deployment health check calls a leftover setting a problem", () => {
    const prod = { VERCEL_ENV: "production", DATABASE_URL: "x", AUTH_SECRET: "a".repeat(40), CRON_SECRET: "c".repeat(20), APP_URL: "https://x.example", GEMINI_API_KEY: "x", GEMINI_MODEL: "x" };
    expect(checkEnvironment({ ...prod, DEMO_OPEN_ACCESS: "1" }).problems.join(" ")).toMatch(/DEMO_OPEN_ACCESS/);
    expect(checkEnvironment(prod).problems).toEqual([]);
    expect(checkEnvironment({ ...prod, VERCEL_ENV: "preview", DEMO_OPEN_ACCESS: "1" }).problems).toEqual([]);
  });
});
