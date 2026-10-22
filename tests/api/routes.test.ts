import { existsSync } from "node:fs";
import path from "node:path";
import { SignJWT } from "jose";
import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { aiDecisions, auditLog, buyingDecisions, reviews, users } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { createSessionToken, sessionCookie } from "@/lib/auth/session";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));

import { POST as login } from "@/app/api/auth/login/route";
import { POST as logout } from "@/app/api/auth/logout/route";
import { PATCH as amend } from "@/app/api/buying-decisions/[id]/route";
import { POST as bulk } from "@/app/api/reviews/bulk-accept/route";
import { POST as review } from "@/app/api/reviews/route";
import { POST as startRunRoute } from "@/app/api/runs/route";
import { POST as validateRoute } from "@/app/api/runs/validate/route";
import { NOW, removeLines, replaceOnce, seedFiles } from "../helpers/seed";
import { TEST_PASSWORD, count, cookieFor, createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, tokenFor, type TestUsers } from "../helpers/workflow";

let db: AnyDb;
let u: TestUsers;
let runId: number;

beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
});
beforeEach(async () => {
  await resetRunData(db);
  runId = (await newSeedRun(db, { createdBy: u.raghav.id })).runId;
});
afterEach(() => vi.useRealTimers());

type Handler = (req: Request, params?: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(
  handler: Handler,
  opts: { token?: string; body?: unknown; form?: FormData; method?: string; headers?: Record<string, string>; params?: Record<string, string> } = {},
) {
  const headers: Record<string, string> = { host: "localhost", ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = cookieFor(opts.token);
  let body: BodyInit | undefined;
  if (opts.form) body = opts.form;
  else if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = typeof opts.body === "string" ? opts.body : JSON.stringify(opts.body);
  }
  const req = new Request("http://localhost/api/test", { method: opts.method ?? "POST", headers, body });
  const res = await handler(req, opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  // The response bodies differ per route; the tests index into them freely.
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  return { status: res.status, json: (await res.json().catch(() => null)) as any, headers: res.headers };
}

describe("F. sign-in is required on every guarded route (401)", () => {
  const cases: Array<[string, Handler, Record<string, string>?]> = [
    ["POST /api/reviews", review],
    ["POST /api/reviews/bulk-accept", bulk],
    ["PATCH /api/buying-decisions/:id", amend, { id: "1" }],
    ["POST /api/runs", startRunRoute],
    ["POST /api/runs/validate", validateRoute],
  ];
  it.each(cases)("%s with no cookie", async (_name, handler, params) => {
    const r = await call(handler, { body: {}, params });
    expect(r.status).toBe(401);
    expect(r.json.error.code).toBe("UNAUTHORIZED");
  });

  it("a garbage, tampered, wrongly signed or expired token is signed out", async () => {
    const good = await tokenFor(u.raghav);
    const key = (s: string) => new TextEncoder().encode(s);
    const wrongKey = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(String(u.raghav.id)).setExpirationTime("1h").sign(key("a-different-secret-that-is-long-enough-123456"));
    const expired = await new SignJWT({}).setProtectedHeader({ alg: "HS256" }).setSubject(String(u.raghav.id)).setIssuedAt(1000).setExpirationTime(2000).sign(key(process.env.AUTH_SECRET!));
    const tampered = good.slice(0, -3) + (good.endsWith("AAA") ? "BBB" : "AAA");
    for (const token of ["garbage", tampered, wrongKey, expired, "e30.e30."]) {
      expect((await call(review, { token, body: { aiDecisionId: 1, outcome: "accepted" } })).status).toBe(401);
    }
  });

  it("a deactivated account is signed out at once, even with a valid token", async () => {
    const token = await tokenFor(u.raghav);
    const id = await idFor(db, runId, "SKU001");
    await db.update(users).set({ active: false }).where(eq(users.id, u.raghav.id));
    try {
      expect((await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } })).status).toBe(401);
    } finally {
      await db.update(users).set({ active: true }).where(eq(users.id, u.raghav.id));
    }
  });
});

describe("F. only the right role passes (403)", () => {
  const others = ROLES.filter((r) => r !== "raghav" && r !== "admin");

  it.each(others)("%s gets 403 on review, bulk accept and amend, and nothing changes", async (role) => {
    const token = await tokenFor(u[role]);
    const id = await idFor(db, runId, "SKU001");
    const a = await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } });
    const b = await call(bulk, { token, body: { aiDecisionIds: [id] } });
    const c = await call(amend, { token, method: "PATCH", body: { action: "REORDER", quantity: 5, reason: "I would like to try" }, params: { id: "1" } });
    expect([a.status, b.status, c.status]).toEqual([403, 403, 403]);
    expect(a.json.error.code).toBe("FORBIDDEN");
    expect(await count(db, "reviews")).toBe(0);
    expect(await count(db, "buying_decisions")).toBe(0);
  });

  it.each(["procurement", "priya", "deepa", "ceo", "admin"] as const)("%s cannot start or validate a run (403)", async (role) => {
    const token = await tokenFor(u[role]);
    expect((await call(startRunRoute, { token, form: new FormData() })).status).toBe(403);
    expect((await call(validateRoute, { token, form: new FormData() })).status).toBe(403);
  });

  it("raghav can review (200) and the buying decision exists", async () => {
    const token = await tokenFor(u.raghav);
    const id = await idFor(db, runId, "SKU001");
    const r = await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ outcome: "accepted", finalAction: "REORDER", finalQty: 750 });
    expect(await count(db, "buying_decisions")).toBe(1);
  });

  it("an admin can review as break-glass, and it is audit-logged", async () => {
    const token = await tokenFor(u.admin);
    const id = await idFor(db, runId, "SKU001");
    expect((await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } })).status).toBe(200);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "review.break_glass"))).toHaveLength(1);
  });

  it("maps validation problems to 400 with a code, and a second review to 409", async () => {
    const token = await tokenFor(u.raghav);
    const id = await idFor(db, runId, "SKU001");
    const noReason = await call(review, { token, body: { aiDecisionId: id, outcome: "rejected", change: { flagTypes: [], action: "NO_ACTION", quantity: 0 } } });
    expect(noReason.status).toBe(400);
    expect(noReason.json.error.code).toBe("REASON_REQUIRED");
    const noChange = await call(review, { token, body: { aiDecisionId: id, outcome: "rejected", change: { flagTypes: [], action: "REORDER", quantity: 750, reasonCode: "WRONG_FLAG" } } });
    expect(noChange.json.error.code).toBe("NO_CHANGE");
    expect((await call(review, { token, body: "{not json" })).json.error.code).toBe("BAD_JSON");
    expect((await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } })).status).toBe(200);
    expect((await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } })).status).toBe(409);
    expect((await call(review, { token, body: { aiDecisionId: 9999, outcome: "accepted" } })).status).toBe(404);
  });

  it("bulk accept maps ineligible batches to 400 with the offending SKUs", async () => {
    const token = await tokenFor(u.raghav);
    const ids = [await idFor(db, runId, "SKU003"), await idFor(db, runId, "SKU004")];
    await db.update(aiDecisions).set({ needsJudgment: true }).where(eq(aiDecisions.id, ids[0]));
    const r = await call(bulk, { token, body: { aiDecisionIds: ids } });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("BULK_NOT_ALLOWED");
    expect(r.json.error.details).toEqual([{ aiDecisionId: ids[0], sku: "SKU003", needsJudgment: true, isFallback: false }]);
    expect(await count(db, "reviews")).toBe(0);
    const ok = await call(bulk, { token, body: { aiDecisionIds: [ids[1]] } });
    expect(ok.status).toBe(200);
    expect(ok.json.accepted).toBe(1);
  });

  it("the amend route validates the id", async () => {
    const token = await tokenFor(u.raghav);
    expect((await call(amend, { token, method: "PATCH", body: {}, params: { id: "abc" } })).json.error.code).toBe("BAD_ID");
  });

  it("amending after review works for Raghav and is audited", async () => {
    const token = await tokenFor(u.raghav);
    const id = await idFor(db, runId, "SKU001");
    await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } });
    const [buy] = await db.select().from(buyingDecisions);
    const r = await call(amend, { token, method: "PATCH", body: { action: "REORDER", quantity: 600, reason: "Supplier batch is smaller" }, params: { id: String(buy.id) } });
    expect(r.status).toBe(200);
    expect(await db.select().from(auditLog).where(eq(auditLog.action, "buying_decision.amended"))).toHaveLength(1);
    expect(await db.select().from(reviews)).toHaveLength(1);
  });
});

describe("F. a buying decision can never be created directly (G-B1)", () => {
  it("there is no route that creates one", async () => {
    const mod = await import("@/app/api/buying-decisions/[id]/route");
    expect((mod as Record<string, unknown>).POST).toBeUndefined();
    expect((mod as Record<string, unknown>).PUT).toBeUndefined();
    expect(existsSync(path.resolve(__dirname, "../../src/app/api/buying-decisions/route.ts"))).toBe(false);
  });
});

describe("cross-site requests are refused", () => {
  it("a write from another origin gets 403 even with a valid session", async () => {
    const token = await tokenFor(u.raghav);
    const id = await idFor(db, runId, "SKU001");
    const r = await call(review, { token, headers: { origin: "https://evil.example" }, body: { aiDecisionId: id, outcome: "accepted" } });
    expect(r.status).toBe(403);
    expect(await count(db, "reviews")).toBe(0);
    const same = await call(review, { token, headers: { origin: "http://localhost" }, body: { aiDecisionId: id, outcome: "accepted" } });
    expect(same.status).toBe(200);
  });
});

describe("sign in and out (G-S6)", () => {
  const body = (over: Record<string, unknown> = {}) => ({ email: "raghav@freshroots.test", password: TEST_PASSWORD, ...over });

  it("signs in, sets an httpOnly sameSite=lax cookie, and the cookie then works", async () => {
    const r = await call(login, { body: body() });
    expect(r.status).toBe(200);
    expect(r.json).toEqual({ user: { name: "Test raghav", role: "raghav" }, home: "/review" });
    const cookie = r.headers.get("set-cookie")!;
    expect(cookie).toMatch(/^fr_session=/);
    expect(cookie).toContain("HttpOnly");
    expect(cookie).toContain("SameSite=Lax");
    expect(cookie).toContain("Path=/");
    const token = /fr_session=([^;]+)/.exec(cookie)![1];
    const id = await idFor(db, runId, "SKU001");
    expect((await call(review, { token, body: { aiDecisionId: id, outcome: "accepted" } })).status).toBe(200);
  });

  it("the cookie is Secure in production", () => {
    expect(sessionCookie("t", { NODE_ENV: "production" } as unknown as NodeJS.ProcessEnv)).toContain("; Secure");
    expect(sessionCookie("t", { NODE_ENV: "development" } as unknown as NodeJS.ProcessEnv)).not.toContain("Secure");
  });

  it("is case-insensitive on email and sends each role home", async () => {
    const homes: Record<string, string> = { raghav: "/review", procurement: "/orders", priya: "/dashboard", deepa: "/dashboard", ceo: "/dashboard", admin: "/dashboard" };
    for (const role of ROLES) {
      const r = await call(login, { body: body({ email: `  ${role.toUpperCase()}@Freshroots.test `.trim() }) });
      expect(r.status).toBe(200);
      expect(r.json.home).toBe(homes[role]);
    }
  });

  it("a wrong password, an unknown email and a deactivated account all get the same 401", async () => {
    await db.update(users).set({ active: false }).where(eq(users.id, u.priya.id));
    const wrong = await call(login, { body: body({ password: "not-the-password" }) });
    const unknown = await call(login, { body: body({ email: "nobody@freshroots.test" }) });
    const inactive = await call(login, { body: body({ email: "priya@freshroots.test" }) });
    await db.update(users).set({ active: true }).where(eq(users.id, u.priya.id));
    for (const r of [wrong, unknown, inactive]) {
      expect(r.status).toBe(401);
      expect(r.json).toEqual({ error: { code: "BAD_LOGIN", message: "Email or password is wrong." } });
      expect(r.headers.get("set-cookie")).toBeNull();
    }
  });

  it("rejects an empty or malformed body", async () => {
    expect((await call(login, { body: {} })).status).toBe(401);
    expect((await call(login, { body: "nope" })).status).toBe(400);
    expect((await call(login, { body: { email: 5, password: [] } })).status).toBe(401);
  });

  it("a user with no password set cannot sign in", async () => {
    await db.update(users).set({ passwordHash: null }).where(eq(users.id, u.ceo.id));
    const r = await call(login, { body: body({ email: "ceo@freshroots.test" }) });
    expect(r.status).toBe(401);
  });

  it("signs out by clearing the cookie", async () => {
    const r = await call(logout, {});
    expect(r.status).toBe(200);
    expect(r.headers.get("set-cookie")).toMatch(/fr_session=; .*Max-Age=0/);
  });

  it("the token carries only the user id, never the role or password", async () => {
    const token = await createSessionToken(u.raghav.id);
    const payload = JSON.parse(Buffer.from(token.split(".")[1], "base64url").toString());
    expect(Object.keys(payload).sort()).toEqual(["exp", "iat", "sub"]);
  });
});

describe("upload endpoints (G-D1, G-S4)", () => {
  function form(files: Record<string, string | undefined>, extra: Record<string, string> = {}, names: Record<string, string> = {}) {
    const f = new FormData();
    for (const [key, text] of Object.entries(files)) {
      if (text !== undefined) f.append(key, new File([text], names[key] ?? `${key}.csv`, { type: "text/csv" }));
    }
    for (const [k, v] of Object.entries(extra)) f.append(k, v);
    return f;
  }
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(NOW);
  });

  it("validate returns the report and stores nothing", async () => {
    await resetRunData(db);
    const token = await tokenFor(u.raghav);
    const r = await call(validateRoute, { token, form: form(seedFiles()) });
    expect(r.status).toBe(200);
    expect(r.json).toMatchObject({ ok: true, errors: [] });
    expect(r.json.warnings).toHaveLength(1);
    expect(r.json.fileStats.sales).toBe(240);
    expect(await count(db, "data_snapshots")).toBe(0);
  });

  it("start run: an upload with errors is refused with every error listed, and nothing is written", async () => {
    await resetRunData(db);
    const token = await tokenFor(u.raghav);
    const files = seedFiles();
    files.sales = replaceOnce(files.sales, "SKU001,2026-W27,194", "SKU001,2026-W27,-4");
    files.inventory = removeLines(files.inventory, (l) => l.startsWith("SKU015,"));
    const r = await call(startRunRoute, { token, form: form(files, { acknowledgeWarnings: "true" }) });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("VALIDATION_FAILED");
    expect(r.json.error.details.errors.map((e: { code: string }) => e.code).sort()).toEqual(["NEGATIVE_NUMBER", "NO_INVENTORY_ROW"]);
    expect(await count(db, "data_snapshots")).toBe(0);
    expect(await count(db, "runs")).toBe(0);
  });

  it("start run: warnings must be acknowledged", async () => {
    await resetRunData(db);
    const token = await tokenFor(u.raghav);
    const r = await call(startRunRoute, { token, form: form(seedFiles()) });
    expect(r.status).toBe(422);
    expect(r.json.error.code).toBe("WARNINGS_NOT_ACKNOWLEDGED");
    expect(await count(db, "runs")).toBe(0);
  });

  it("start run: with warnings acknowledged it creates the run with 7 flags and 7 decisions", async () => {
    await resetRunData(db);
    const token = await tokenFor(u.raghav);
    const r = await call(startRunRoute, { token, form: form(seedFiles(), { acknowledgeWarnings: "true" }) });
    expect(r.status).toBe(201);
    expect(r.json).toMatchObject({ flagCount: 7, fallbackCount: 0, fallbackWarning: false, status: "in_review", warnings: 1 });
    expect(await count(db, "flags")).toBe(7);
    expect(await count(db, "ai_decisions")).toBe(7);
    const log = await db.select().from(auditLog);
    expect(log.map((l) => l.action).sort()).toEqual(["run.ai_done", "run.created", "snapshot.uploaded"]);
  });

  it("start run: master files can be reused from the previous upload", async () => {
    await resetRunData(db);
    const token = await tokenFor(u.raghav);
    const files = seedFiles();
    expect((await call(startRunRoute, { token, form: form(files, { acknowledgeWarnings: "true" }) })).status).toBe(201);
    const partial = { sales: files.sales, inventory: files.inventory };
    const without = await call(startRunRoute, { token, form: form(partial, { acknowledgeWarnings: "true" }) });
    expect(without.status).toBe(422);
    expect(without.json.error.details.errors.every((e: { code: string }) => e.code === "MISSING_FILE")).toBe(true);
    const withPrevious = await call(startRunRoute, { token, form: form(partial, { acknowledgeWarnings: "true", usePreviousMasters: "true" }) });
    expect(withPrevious.status).toBe(201);
    expect(await count(db, "runs")).toBe(2);
  });

  it("only .csv files are accepted", async () => {
    const token = await tokenFor(u.raghav);
    const r = await call(validateRoute, { token, form: form(seedFiles(), {}, { sales: "weekly_sales.xlsx" }) });
    expect(r.status).toBe(400);
    expect(r.json.error.code).toBe("NOT_CSV");
  });

  it("a non-multipart body is a 400", async () => {
    const token = await tokenFor(u.raghav);
    expect((await call(validateRoute, { token, body: {} })).json.error.code).toBe("BAD_FORM");
  });

  it("when the AI fails for every flag the run still opens, all fallbacks, with the run-level warning", async () => {
    await resetRunData(db);
    const { startSeedRun } = await import("../helpers/workflow");
    const run = await startSeedRun(db, u.raghav, { handler: () => "not json" });
    expect(run).toMatchObject({ flagCount: 7, fallbackCount: 7, fallbackWarning: true, status: "in_review" });
  });
});
