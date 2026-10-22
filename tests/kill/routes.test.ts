import { eq } from "drizzle-orm";
import { afterEach, beforeAll, beforeEach, describe, expect, it, vi } from "vitest";
import { auditLog, buyingDecisions, killEvents, lossEntries } from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { ROLES } from "@/lib/auth/permissions";
import { assertCronSecret } from "@/lib/auth/cron";
import { parseCsv } from "@/lib/validation/csv";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));

import { GET as cronRoute } from "@/app/api/cron/kill-check/route";
import { POST as acknowledgeRoute } from "@/app/api/kill/acknowledge/route";
import { POST as rearmRoute } from "@/app/api/kill/rearm/route";
import { PATCH as lossPatch } from "@/app/api/loss-entries/[id]/route";
import { POST as lossPost } from "@/app/api/loss-entries/route";
import { GET as metricsExport } from "@/app/api/metrics/export/route";
import { POST as releaseRoute } from "@/app/api/orders/release/route";
import { cookieFor, count, createTestDb, idFor, newSeedRun, resetRunData, seedTestUsers, tokenFor, type TestUsers } from "../helpers/workflow";
import { reviewDecision } from "@/lib/workflow/review";

let db: AnyDb;
let u: TestUsers;

beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
});
beforeEach(() => resetRunData(db));
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllEnvs();
});

type Handler = (req: Request, params?: { params: Promise<Record<string, string>> }) => Promise<Response>;

async function call(handler: Handler, opts: { method?: string; token?: string; body?: unknown; headers?: Record<string, string>; url?: string; params?: Record<string, string> } = {}) {
  const headers: Record<string, string> = { host: "localhost", ...(opts.headers ?? {}) };
  if (opts.token) headers.cookie = cookieFor(opts.token);
  let body: string | undefined;
  if (opts.body !== undefined) {
    headers["content-type"] = "application/json";
    body = JSON.stringify(opts.body);
  }
  const res = await handler(new Request(opts.url ?? "http://localhost/api/x", { method: opts.method ?? "POST", headers, body }), opts.params ? { params: Promise.resolve(opts.params) } : undefined);
  const text = await res.text();
  let json: any = null; // eslint-disable-line @typescript-eslint/no-explicit-any
  try {
    json = JSON.parse(text);
  } catch {
    /* not JSON (a CSV) */
  }
  return { status: res.status, json, text, headers: res.headers };
}

const loss = (over: Record<string, unknown> = {}) => ({ periodStart: "2026-10-01", periodEnd: "2026-10-31", stockoutLossRupees: 100, overstockWriteoffRupees: 0, ...over });
const REASON = "Reviewed together; continuing with a close watch";

// Pin "today" to the October to December 2026 quarter for routes that use the real clock.
function today() {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-23T11:00:00+05:30"));
}

describe("new routes need sign-in (401)", () => {
  const cases: Array<[string, Handler, string, Record<string, string>?]> = [
    ["POST /api/loss-entries", lossPost, "POST"],
    ["PATCH /api/loss-entries/:id", lossPatch, "PATCH", { id: "1" }],
    ["POST /api/kill/rearm", rearmRoute, "POST"],
    ["POST /api/kill/acknowledge", acknowledgeRoute, "POST"],
    ["POST /api/orders/release", releaseRoute, "POST"],
    ["GET /api/metrics/export", metricsExport, "GET"],
  ];
  it.each(cases)("%s with no cookie", async (_n, handler, method, params) => {
    const r = await call(handler, { method, body: method === "GET" ? undefined : {}, params });
    expect(r.status).toBe(401);
  });
});

describe("every role on every new route", () => {
  it.each(ROLES.filter((r) => r !== "priya"))("%s cannot enter or edit losses (403)", async (role) => {
    const token = await tokenFor(u[role]);
    expect((await call(lossPost, { token, body: loss() })).status).toBe(403);
    expect((await call(lossPatch, { token, method: "PATCH", body: loss(), params: { id: "1" } })).status).toBe(403);
    expect(await count(db, "loss_entries")).toBe(0);
  });

  it.each(ROLES.filter((r) => r !== "deepa" && r !== "ceo"))("%s cannot re-arm (403)", async (role) => {
    expect((await call(rearmRoute, { token: await tokenFor(u[role]), body: { which: 1, reason: REASON } })).status).toBe(403);
  });

  it.each(ROLES.filter((r) => r !== "deepa"))("%s cannot acknowledge an alert (403)", async (role) => {
    expect((await call(acknowledgeRoute, { token: await tokenFor(u[role]) })).status).toBe(403);
  });

  it.each(ROLES.filter((r) => r !== "raghav" && r !== "admin"))("%s cannot release held orders (403)", async (role) => {
    expect((await call(releaseRoute, { token: await tokenFor(u[role]), body: { ids: [1], reason: REASON } })).status).toBe(403);
  });

  it.each(ROLES.filter((r) => r !== "priya"))("%s cannot export metrics (403)", async (role) => {
    expect((await call(metricsExport, { token: await tokenFor(u[role]), method: "GET" })).status).toBe(403);
  });
});

describe("loss entries over HTTP", () => {
  it("Priya saves an entry and gets the Kill 2 verdict straight back", async () => {
    today();
    const token = await tokenFor(u.priya);
    const ok = await call(lossPost, { token, body: loss({ stockoutLossRupees: 2_900_000 }) });
    expect(ok.status).toBe(201);
    expect(ok.json).toMatchObject({ overlaps: [], kill2: { state: "alert", changed: true, total: 2_900_000 } });
    expect(await count(db, "kill_events")).toBe(1);
    const dup = await call(lossPost, { token, body: loss() });
    expect([dup.status, dup.json.error.code]).toEqual([409, "DUPLICATE_PERIOD"]);
    const bad = await call(lossPost, { token, body: loss({ stockoutLossRupees: -5 }) });
    expect([bad.status, bad.json.error.code]).toEqual([400, "BAD_AMOUNT"]);
  });

  it("an edit through the API re-checks Kill 2", async () => {
    today();
    const token = await tokenFor(u.priya);
    const created = await call(lossPost, { token, body: loss() });
    const edit = await call(lossPatch, { token, method: "PATCH", body: loss({ stockoutLossRupees: 3_500_000 }), params: { id: String(created.json.id) } });
    expect(edit.status).toBe(200);
    expect(edit.json.kill2.state).toBe("killed");
    const missing = await call(lossPatch, { token, method: "PATCH", body: loss(), params: { id: "999" } });
    expect(missing.status).toBe(404);
    const badId = await call(lossPatch, { token, method: "PATCH", body: loss(), params: { id: "abc" } });
    expect(badId.json.error.code).toBe("BAD_ID");
  });

  it("a request from another site is refused", async () => {
    const token = await tokenFor(u.priya);
    const r = await call(lossPost, { token, headers: { origin: "https://evil.example" }, body: loss() });
    expect(r.status).toBe(403);
    expect(await count(db, "loss_entries")).toBe(0);
  });
});

describe("re-arm, acknowledge and release over HTTP", () => {
  async function killTwo() {
    today();
    const token = await tokenFor(u.priya);
    await call(lossPost, { token, body: loss({ periodStart: "2026-10-01", periodEnd: "2026-10-15", stockoutLossRupees: 2_900_000 }) });
    await call(lossPost, { token, body: loss({ periodStart: "2026-10-16", periodEnd: "2026-10-31", stockoutLossRupees: 600_000 }) });
  }

  it("Deepa re-arms Kill 2: refused until she confirms it will fire again, then done", async () => {
    await killTwo();
    const token = await tokenFor(u.deepa);
    const first = await call(rearmRoute, { token, body: { which: 2, reason: REASON } });
    expect([first.status, first.json.error.code]).toEqual([409, "REARM_WOULD_REFIRE"]);
    expect(first.json.error.details).toEqual({ total: 3_500_000, killAbove: 3_400_000 });
    const second = await call(rearmRoute, { token, body: { which: 2, reason: REASON, confirmRefire: true } });
    expect(second.status).toBe(200);
    expect(second.json).toMatchObject({ which: 2, state: "alert", refireWarning: true });
    const short = await call(rearmRoute, { token, body: { which: 1, reason: "short" } });
    expect(short.json.error.code).toBe("REASON_REQUIRED");
  });

  it("Deepa acknowledges an alert once a week", async () => {
    today();
    await call(lossPost, { token: await tokenFor(u.priya), body: loss({ stockoutLossRupees: 3_000_000 }) });
    const token = await tokenFor(u.deepa);
    const ok = await call(acknowledgeRoute, { token });
    expect([ok.status, ok.json.week]).toEqual([200, "2026-W43"]);
    expect((await call(acknowledgeRoute, { token })).json.error.code).toBe("ALREADY_ACKNOWLEDGED");
  });

  it("Raghav releases a held order with a reason", async () => {
    today();
    const run = await newSeedRun(db, { createdBy: u.raghav.id });
    await reviewDecision(db, u.raghav, { aiDecisionId: await idFor(db, run.runId, "SKU003"), outcome: "accepted" });
    await db.update(buyingDecisions).set({ status: "held" });
    const [held] = await db.select().from(buyingDecisions);
    const token = await tokenFor(u.raghav);
    expect((await call(releaseRoute, { token, body: { ids: [held.id], reason: "no" } })).json.error.code).toBe("REASON_REQUIRED");
    const ok = await call(releaseRoute, { token, body: { ids: [held.id], reason: REASON } });
    expect([ok.status, ok.json]).toEqual([200, { released: 1 }]);
  });
});

describe("metrics export", () => {
  it("Priya downloads CSVs of the summary, the runs and the losses, with injection-safe cells", async () => {
    today();
    const token = await tokenFor(u.priya);
    await call(lossPost, { token, body: loss({ stockoutLossRupees: 1000, overstockWriteoffRupees: 500, note: "=1+1 week" }) });
    const losses = await call(metricsExport, { token, method: "GET", url: "http://localhost/api/metrics/export?kind=losses" });
    expect(losses.status).toBe(200);
    expect(losses.headers.get("content-type")).toBe("text/csv; charset=utf-8");
    expect(losses.headers.get("content-disposition")).toBe('attachment; filename="freshroots-metrics-losses-2026-10-23.csv"');
    const rows = parseCsv(losses.text).map((r) => r.cells);
    expect(rows[0]).toEqual(["entry_id", "period_start", "period_end", "stockout_loss_rupees", "overstock_writeoff_rupees", "total_rupees", "note"]);
    expect(rows[1].slice(1)).toEqual(["2026-10-01", "2026-10-31", "1000", "500", "1500", "'=1+1 week"]);

    const summary = parseCsv((await call(metricsExport, { token, method: "GET" })).text).map((r) => r.cells);
    const get = (m: string) => summary.find((r) => r[0] === m)?.[1];
    expect(get("quarter")).toBe("2026-Q4");
    expect(get("quarter_to_date_loss")).toBe("1500");
    expect(get("kill2_state")).toBe("green");
    expect(get("kill1_state")).toBe("armed");

    const runs = await call(metricsExport, { token, method: "GET", url: "http://localhost/api/metrics/export?kind=runs" });
    expect(parseCsv(runs.text)[0].cells[0]).toBe("run_id");
    const bad = await call(metricsExport, { token, method: "GET", url: "http://localhost/api/metrics/export?kind=everything" });
    expect([bad.status, bad.json.error.code]).toEqual([400, "BAD_KIND"]);
    expect((await db.select().from(auditLog).where(eq(auditLog.action, "metrics.exported"))).length).toBe(3);
  });
});

describe("the daily check (cron)", () => {
  const SECRET = "a-long-enough-cron-secret-0123456789";
  const cron = (headers: Record<string, string> = {}) => call(cronRoute, { method: "GET", headers, url: "http://localhost/api/cron/kill-check" });

  it("is refused without the secret, with a wrong one, and when no secret is configured (fails closed)", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    expect((await cron()).status).toBe(401);
    expect((await cron({ authorization: "Bearer wrong" })).status).toBe(401);
    expect((await cron({ authorization: SECRET.slice(0, -1) })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "");
    expect((await cron({ authorization: "Bearer " })).status).toBe(401);
    expect((await cron({ authorization: "Bearer anything" })).status).toBe(401);
    vi.stubEnv("CRON_SECRET", "short");
    expect((await cron({ authorization: "Bearer short" })).status).toBe(401);
  });

  it("with the right secret it checks Kill 2 and reports the state", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    today();
    const ok = await cron({ authorization: `Bearer ${SECRET}` });
    expect([ok.status, ok.json]).toEqual([200, { state: "green", changed: false, total: 0 }]);
  });

  it("catches what happened outside the app: an entry inserted directly is picked up, once", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    today();
    await db.insert(lossEntries).values({ periodStart: "2026-10-01", periodEnd: "2026-10-31", stockoutLossRupees: 3_000_000, overstockWriteoffRupees: 0, enteredBy: u.priya.id });
    const first = await cron({ authorization: `Bearer ${SECRET}` });
    expect(first.json).toMatchObject({ state: "alert", changed: true });
    const second = await cron({ authorization: `Bearer ${SECRET}` });
    expect(second.json).toMatchObject({ state: "alert", changed: false });
    expect(await db.select().from(killEvents)).toHaveLength(1);
    expect(await count(db, "email_outbox")).toBe(3);
  });

  it("clears an alert when the quarter rolls over", async () => {
    vi.stubEnv("CRON_SECRET", SECRET);
    today();
    await call(lossPost, { token: await tokenFor(u.priya), body: loss({ stockoutLossRupees: 3_000_000 }) });
    vi.setSystemTime(new Date("2027-01-02T07:00:00+05:30"));
    const res = await cron({ authorization: `Bearer ${SECRET}` });
    expect(res.json).toMatchObject({ state: "green", changed: true });
  });

  it("the secret comparison accepts only the exact secret", () => {
    const env = { CRON_SECRET: SECRET };
    expect(() => assertCronSecret(new Request("http://x", { headers: { authorization: `Bearer ${SECRET}` } }), env)).not.toThrow();
    expect(() => assertCronSecret(new Request("http://x", { headers: { authorization: `Bearer ${SECRET}x` } }), env)).toThrow();
    expect(() => assertCronSecret(new Request("http://x"), env)).toThrow();
  });

  it("is scheduled daily in vercel.json", async () => {
    const config = JSON.parse((await import("node:fs")).readFileSync("vercel.json", "utf8"));
    expect(config.crons).toEqual([{ path: "/api/cron/kill-check", schedule: "30 0 * * *" }]);
  });
});
