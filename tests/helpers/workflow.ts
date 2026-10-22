import { PGlite } from "@electric-sql/pglite";
import { eq, sql } from "drizzle-orm";
import { drizzle } from "drizzle-orm/pglite";
import { migrate } from "drizzle-orm/pglite/migrator";
import path from "node:path";
import * as schema from "@/db/schema";
import { users } from "@/db/schema";
import { storeSnapshot, type AnyDb } from "@/db/snapshots";
import { createMockClient, echoHandler, type MockHandler } from "@/lib/ai/mock";
import type { AiRuntime } from "@/lib/ai/factory";
import { hashPassword } from "@/lib/auth/password";
import { ROLES, type Role } from "@/lib/auth/permissions";
import { createSessionToken, SESSION_COOKIE, type SessionUser } from "@/lib/auth/session";
import { loadRules, type RulesConfig } from "@/lib/config/rules";
import { createRun, type CreatedRun } from "@/lib/workflow/runs";
import { startRun } from "@/lib/workflow/startRun";
import type { UploadFiles } from "@/lib/validation/types";
import { fastRules, prompts } from "./ai";
import { NOW, seedFiles, validate } from "./seed";

export const TEST_PASSWORD = "correct-horse-battery";

export async function createTestDb(): Promise<AnyDb> {
  const db = drizzle(new PGlite(), { schema });
  await migrate(db, { migrationsFolder: path.resolve(__dirname, "../../drizzle") });
  return db as unknown as AnyDb;
}

export type TestUsers = Record<Role, SessionUser>;

/** One account per role, all with the same test password. */
export async function seedTestUsers(db: AnyDb): Promise<TestUsers> {
  const hash = await hashPassword(TEST_PASSWORD);
  const out = {} as TestUsers;
  for (const role of ROLES) {
    const [u] = await db
      .insert(users)
      .values({ name: `Test ${role}`, email: `${role}@freshroots.test`, role, passwordHash: hash })
      .returning();
    out[role] = { id: u.id, name: u.name, email: u.email, role: u.role };
  }
  return out;
}

/** Clears everything a run creates. TRUNCATE is the one thing the append-only triggers do not (and should not) block. */
export async function resetRunData(db: AnyDb): Promise<void> {
  await db.execute(
    sql`TRUNCATE buying_decisions, reviews, ai_decisions, flags, runs, audit_log, weekly_sales, inventory, data_snapshots RESTART IDENTITY CASCADE`,
  );
}

export async function tokenFor(user: SessionUser): Promise<string> {
  return createSessionToken(user.id);
}

export function aiRuntime(handler: MockHandler = echoHandler): AiRuntime {
  return { client: createMockClient(handler), model: "mock-model", prompts };
}

/** The seed data stored as a snapshot and run through the rule engine and the (mock) AI. */
export async function newSeedRun(
  db: AnyDb,
  opts: { handler?: MockHandler; createdBy?: number | null; rules?: RulesConfig } = {},
): Promise<CreatedRun & { snapshotId: number }> {
  const rules = opts.rules ?? fastRules();
  const files = seedFiles();
  const result = validate(files, { rules, now: NOW });
  const { snapshotId } = await storeSnapshot(db, { uploadedBy: opts.createdBy ?? null, files, result });
  const run = await createRun(db, {
    snapshotId,
    createdBy: opts.createdBy ?? null,
    rules,
    client: createMockClient(opts.handler ?? echoHandler),
    model: "mock-model",
    prompts,
  });
  return { ...run, snapshotId };
}

/** A run through the same path the app uses (upload, validate, store, flag, decide). */
export async function startSeedRun(
  db: AnyDb,
  actor: SessionUser,
  opts: { files?: UploadFiles; acknowledgeWarnings?: boolean; handler?: MockHandler; rules?: RulesConfig } = {},
) {
  const rules = opts.rules ?? fastRules();
  return startRun(db, actor, {
    files: opts.files ?? seedFiles(),
    acknowledgeWarnings: opts.acknowledgeWarnings ?? true,
    rules,
    ai: aiRuntime(opts.handler),
    now: NOW,
  });
}

export async function decisionIds(db: AnyDb, runId: number) {
  const rows = await db
    .select({ id: schema.aiDecisions.id, skuId: schema.flags.skuId, status: schema.aiDecisions.status })
    .from(schema.aiDecisions)
    .innerJoin(schema.flags, eq(schema.flags.id, schema.aiDecisions.flagId))
    .where(eq(schema.flags.runId, runId))
    .orderBy(schema.flags.skuId);
  return rows;
}

export async function idFor(db: AnyDb, runId: number, skuId: string): Promise<number> {
  const row = (await decisionIds(db, runId)).find((r) => r.skuId === skuId);
  if (!row) throw new Error(`no decision for ${skuId} in run ${runId}`);
  return row.id;
}

/** Row count of a table, by name. */
export async function count(db: AnyDb, table: string): Promise<number> {
  const res = await db.execute(sql.raw(`SELECT count(*)::int AS n FROM "${table}"`));
  return (res.rows[0] as { n: number }).n;
}

export function cookieFor(token: string): string {
  return `${SESSION_COOKIE}=${token}`;
}

export { loadRules };
