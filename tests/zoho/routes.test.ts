import { readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";
import { beforeAll, describe, expect, it, vi } from "vitest";
import type { AnyDb } from "@/db/snapshots";
import { createSessionToken } from "@/lib/auth/session";
import { cookieFor, createTestDb, resetRunData, seedTestUsers, type TestUsers } from "../helpers/workflow";

const holder = vi.hoisted(() => ({ db: null as unknown }));
vi.mock("@/db/client", () => ({ getDb: () => holder.db, closeDb: async () => {} }));

import { POST as sendRoute } from "@/app/api/zoho/send/route";
import { POST as syncRoute } from "@/app/api/zoho/sync/route";

let db: AnyDb;
let u: TestUsers;
beforeAll(async () => {
  db = await createTestDb();
  holder.db = db;
  u = await seedTestUsers(db);
  await resetRunData(db);
});

type Handler = (req: Request) => Promise<Response>;
const call = async (h: Handler, token?: string, body: unknown = {}) => {
  const headers: Record<string, string> = { host: "localhost", "content-type": "application/json" };
  if (token) headers.cookie = cookieFor(token);
  const res = await h(new Request("http://localhost/api/zoho", { method: "POST", headers, body: JSON.stringify(body) }));
  return { status: res.status, json: (await res.json().catch(() => null)) as { error?: { code?: string } } | null };
};

describe("the Zoho routes", () => {
  it.each([
    ["send", sendRoute],
    ["sync", syncRoute],
  ] as const)("%s needs a signed-in user (401)", async (_n, h) => {
    expect((await call(h)).status).toBe(401);
  });

  it.each(["raghav", "priya", "deepa", "ceo", "admin"] as const)("%s is refused (403) on both", async (role) => {
    const token = await createSessionToken(u[role].id);
    expect((await call(sendRoute, token, { ids: [1] })).status).toBe(403);
    expect((await call(syncRoute, token)).status).toBe(403);
  });

  it("procurement gets a clear 409 when Zoho is not connected on this deployment", async () => {
    const token = await createSessionToken(u.procurement.id);
    const send = await call(sendRoute, token, { ids: [1] });
    expect(send.status).toBe(409);
    expect(send.json?.error?.code).toBe("ZOHO_NOT_CONNECTED");
    expect((await call(syncRoute, token)).json?.error?.code).toBe("ZOHO_NOT_CONNECTED");
  });

  it("bad ids are a 400 before anything else", async () => {
    const token = await createSessionToken(u.procurement.id);
    expect((await call(sendRoute, token, { ids: [] })).json?.error?.code).toBe("BAD_IDS");
  });
});

describe("Zoho's secrets stay in one server-only place", () => {
  const root = path.resolve(__dirname, "../../src");
  const files = (dir: string): string[] =>
    readdirSync(dir).flatMap((f) => {
      const p = path.join(dir, f);
      return statSync(p).isDirectory() ? files(p) : [p];
    });
  const all = files(root).filter((f) => /\.(ts|tsx)$/.test(f));
  const rel = (f: string) => path.relative(root, f).split(path.sep).join("/");

  it("only the Zoho client reads the client secret and the refresh token", () => {
    const readers = all.filter((f) => /ZOHO_CLIENT_SECRET|ZOHO_REFRESH_TOKEN/.test(readFileSync(f, "utf8"))).map(rel);
    expect(readers).toEqual(["lib/zoho/client.ts"]);
  });

  it("no browser component imports anything Zoho-related that holds a secret", () => {
    const offenders = all
      .filter((f) => readFileSync(f, "utf8").startsWith('"use client"'))
      .filter((f) => /@\/lib\/zoho\/client|@\/lib\/workflow\/zoho|@\/lib\/orders\/zohoSink/.test(readFileSync(f, "utf8")))
      .map(rel);
    expect(offenders).toEqual([]);
  });

  it("the order sink never sends a price or a status", () => {
    const sink = readFileSync(path.join(root, "lib/orders/zohoSink.ts"), "utf8");
    expect(sink).not.toMatch(/purchase_rate|\brate\b\s*:|status\s*:\s*["'](issued|open)/);
    const client = readFileSync(path.join(root, "lib/zoho/client.ts"), "utf8");
    expect(client).not.toMatch(/status\/issued|status\/cancelled|status\/open|\/approve|DELETE/);
  });
});
