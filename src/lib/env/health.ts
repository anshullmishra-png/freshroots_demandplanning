import { is, sql } from "drizzle-orm";
import { PgTable, getTableConfig } from "drizzle-orm/pg-core";
import * as schema from "@/db/schema";
import type { AnyDb } from "@/db/snapshots";
import { checkEnvironment, type EnvReport } from "./check";

export interface DeepHealth {
  ok: boolean;
  database: { reachable: boolean; missingTables: string[]; killStateRow: boolean };
  environment: Pick<EnvReport, "environment" | "present" | "aiMode" | "emailProvider">;
  problems: string[];
  warnings: string[];
}

/** Every table the schema defines, by its database name. */
export function expectedTables(): string[] {
  return Object.values(schema)
    .filter((x) => is(x, PgTable))
    .map((t) => getTableConfig(t as PgTable).name)
    .sort();
}

/**
 * Can this deployment do its job? Database reachable, every table present (so migrations were applied), the kill-state
 * row exists, and the environment is complete. Returns facts about configuration, never values.
 */
export async function deepHealth(db: AnyDb, env: Record<string, string | undefined> = process.env): Promise<DeepHealth> {
  const report = checkEnvironment(env);
  const problems = [...report.problems];
  const database = { reachable: false, missingTables: [] as string[], killStateRow: false };
  try {
    const found = await db.execute(sql`SELECT table_name FROM information_schema.tables WHERE table_schema = 'public'`);
    database.reachable = true;
    const have = new Set(found.rows.map((r: unknown) => (r as { table_name: string }).table_name));
    database.missingTables = expectedTables().filter((t) => !have.has(t));
    if (database.missingTables.length > 0) problems.push(`Migrations are not applied: missing ${database.missingTables.join(", ")}.`);
    else {
      const k = await db.execute(sql`SELECT 1 AS one FROM kill_state WHERE id = 1`);
      database.killStateRow = k.rows.length === 1;
      if (!database.killStateRow) problems.push("The kill_state row is missing, so the safety switches cannot work.");
    }
  } catch {
    // The driver's message can include the connection string. Say only that it failed.
    problems.push("The database could not be reached.");
  }
  const { environment, present, aiMode, emailProvider } = report;
  return {
    ok: problems.length === 0,
    database,
    environment: { environment, present, aiMode, emailProvider },
    problems,
    warnings: report.warnings,
  };
}
