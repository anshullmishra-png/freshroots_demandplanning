import { readFileSync } from "node:fs";
import path from "node:path";
import { afterAll, beforeAll, describe, expect, it, vi } from "vitest";
import type { AnyDb } from "@/db/snapshots";
import { getAiRuntime } from "@/lib/ai/factory";
import { loadRules } from "@/lib/config/rules";
import { checkEnvironment, isProduction } from "@/lib/env/check";
import { deepHealth, expectedTables } from "@/lib/env/health";
import { createTestDb } from "../helpers/workflow";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));
import { GET as deepRoute } from "@/app/api/health/deep/route";
import { GET as plainHealth } from "@/app/api/health/route";

const GOOD = {
  VERCEL_ENV: "production",
  DATABASE_URL: "postgres-placeholder",
  AUTH_SECRET: "a".repeat(40),
  CRON_SECRET: "c".repeat(24),
  APP_URL: "https://freshroots.example.app",
  GEMINI_API_KEY: "placeholder-key-value",
  GEMINI_MODEL: "some-model",
  EMAIL_PROVIDER: "console",
};

describe("environment check", () => {
  it("a complete production setup has no problems, only the email warning", () => {
    const r = checkEnvironment(GOOD);
    expect(r.problems).toEqual([]);
    expect(r.warnings).toHaveLength(1);
    expect(r.warnings[0]).toMatch(/reach nobody/);
    expect(r).toMatchObject({ environment: "production", production: true, aiMode: "gemini", emailProvider: "console" });
  });

  it("another email provider clears the warning", () => {
    expect(checkEnvironment({ ...GOOD, EMAIL_PROVIDER: "resend" }).warnings).toEqual([]);
  });

  it.each(["DATABASE_URL", "AUTH_SECRET", "CRON_SECRET", "GEMINI_API_KEY", "GEMINI_MODEL"])("a missing %s is a problem and is named", (name) => {
    const env: Record<string, string | undefined> = { ...GOOD };
    delete env[name];
    const r = checkEnvironment(env);
    expect(r.problems.some((p) => p.includes(name))).toBe(true);
    expect(r.present[name]).toBe(false);
  });

  it("short secrets count as missing", () => {
    expect(checkEnvironment({ ...GOOD, AUTH_SECRET: "a".repeat(31) }).present.AUTH_SECRET).toBe(false);
    expect(checkEnvironment({ ...GOOD, AUTH_SECRET: "a".repeat(32) }).present.AUTH_SECRET).toBe(true);
    expect(checkEnvironment({ ...GOOD, CRON_SECRET: "c".repeat(15) }).present.CRON_SECRET).toBe(false);
    expect(checkEnvironment({ ...GOOD, CRON_SECRET: "c".repeat(16) }).present.CRON_SECRET).toBe(true);
  });

  it("production needs an https APP_URL", () => {
    expect(checkEnvironment({ ...GOOD, APP_URL: "http://localhost:3000" }).problems.join(" ")).toMatch(/APP_URL/);
    expect(checkEnvironment({ ...GOOD, APP_URL: undefined }).problems.join(" ")).toMatch(/APP_URL/);
    expect(checkEnvironment({ ...GOOD, VERCEL_ENV: "preview", APP_URL: "http://localhost:3000" }).problems).toEqual([]);
  });

  it("mock AI is a problem on production only", () => {
    expect(checkEnvironment({ ...GOOD, AI_CLIENT: "mock" }).problems.join(" ")).toMatch(/AI_CLIENT=mock/);
    expect(checkEnvironment({ ...GOOD, VERCEL_ENV: "preview", AI_CLIENT: "mock" }).problems).toEqual([]);
  });

  it("with the mock, no Gemini settings are needed", () => {
    const r = checkEnvironment({ VERCEL_ENV: "preview", AI_CLIENT: "mock", DATABASE_URL: "x", AUTH_SECRET: "a".repeat(32), CRON_SECRET: "c".repeat(16) });
    expect(r.problems).toEqual([]);
    expect(r.aiMode).toBe("mock");
  });

  it("only VERCEL_ENV=production counts as production", () => {
    expect(isProduction({ VERCEL_ENV: "production" })).toBe(true);
    for (const v of ["preview", "development", undefined, "Production "]) expect(isProduction({ VERCEL_ENV: v })).toBe(false);
  });

  it("the report never contains a value", () => {
    const json = JSON.stringify(checkEnvironment(GOOD));
    for (const v of [GOOD.AUTH_SECRET, GOOD.CRON_SECRET, GOOD.GEMINI_API_KEY, GOOD.DATABASE_URL]) expect(json).not.toContain(v);
  });
});

describe("the mock AI is refused on production", () => {
  const rules = loadRules();
  const env = (o: Record<string, string>) => o as unknown as NodeJS.ProcessEnv;
  it("throws on production", () => {
    expect(() => getAiRuntime(rules, env({ AI_CLIENT: "mock", VERCEL_ENV: "production" }))).toThrow(/AI_CLIENT=mock/);
  });
  it("works on preview and locally", () => {
    expect(getAiRuntime(rules, env({ AI_CLIENT: "mock", VERCEL_ENV: "preview" })).model).toBe("mock-model");
    expect(getAiRuntime(rules, env({ AI_CLIENT: "mock" })).model).toBe("mock-model");
  });
});

describe("deep health", () => {
  let db: AnyDb;
  beforeAll(async () => {
    db = await createTestDb();
    holder.db = db;
  });

  it("knows every table the schema defines, including the newest", () => {
    const t = expectedTables();
    for (const name of ["users", "runs", "flags", "kill_state", "login_attempts", "audit_log", "email_outbox"]) expect(t).toContain(name);
  });

  it("is ok on a fully migrated database with a complete environment", async () => {
    const h = await deepHealth(db, GOOD);
    expect(h).toMatchObject({ ok: true, problems: [], database: { reachable: true, missingTables: [], killStateRow: true } });
  });

  it("reports an incomplete environment as not ok", async () => {
    const h = await deepHealth(db, { ...GOOD, AUTH_SECRET: undefined });
    expect(h.ok).toBe(false);
    expect(h.problems.join(" ")).toMatch(/AUTH_SECRET/);
  });

  it("reports a missing table (migrations not applied) by name", async () => {
    await db.execute("ALTER TABLE login_attempts RENAME TO login_attempts_gone" as never);
    try {
      const h = await deepHealth(db, GOOD);
      expect(h.ok).toBe(false);
      expect(h.database.missingTables).toEqual(["login_attempts"]);
    } finally {
      await db.execute("ALTER TABLE login_attempts_gone RENAME TO login_attempts" as never);
    }
  });

  it("reports an unreachable database without leaking the driver's message", async () => {
    const broken = { execute: async () => { throw new Error("connect failed for postgres://user:hunter2@host/db"); } } as unknown as AnyDb;
    const h = await deepHealth(broken, GOOD);
    expect(h.ok).toBe(false);
    expect(h.database.reachable).toBe(false);
    expect(JSON.stringify(h)).not.toContain("hunter2");
  });

  describe("the route", () => {
    const call = (headers: Record<string, string> = {}) => deepRoute(new Request("http://localhost/api/health/deep", { headers }));
    const secret = () => "test-only-cron-secret-0123456789";
    beforeAll(() => {
      vi.stubEnv("CRON_SECRET", secret());
    });
    afterAll(() => {
      vi.unstubAllEnvs();
    });

    it("needs the cron secret: 401 without it or with a wrong one", async () => {
      expect((await call()).status).toBe(401);
      expect((await call({ authorization: "Bearer wrong-wrong-wrong-wrong" })).status).toBe(401);
    });

    it("with the secret it answers with facts and no values", async () => {
      const res = await call({ authorization: `Bearer ${secret()}` });
      expect([200, 503]).toContain(res.status);
      const text = await res.text();
      for (const k of ["DATABASE_URL", "AUTH_SECRET", "GEMINI_API_KEY", "CRON_SECRET"]) {
        const v = process.env[k];
        if (v) expect(text).not.toContain(v);
      }
      expect(JSON.parse(text)).toHaveProperty("environment.present");
      expect(res.headers.get("cache-control")).toBe("no-store");
    });
  });

  it("the plain health route stays public and tells nothing", async () => {
    const res = plainHealth();
    expect(await res.json()).toEqual({ status: "ok" });
  });
});

describe("demo accounts need asking for", () => {
  it("seed-users refuses to invent demo accounts without --demo", () => {
    const src = readFileSync(path.resolve(__dirname, "../../scripts/seed-users.ts"), "utf8");
    expect(src).toMatch(/process\.argv\.includes\("--demo"\)/);
    expect(src.indexOf('process.argv.includes("--demo")')).toBeLessThan(src.indexOf("`${role}@freshroots.test`"));
  });
});
