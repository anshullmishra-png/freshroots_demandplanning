import { Pool, neonConfig } from "@neondatabase/serverless";

/**
 * Reads from the test database, for the few facts a browser cannot see (the email queue). Returns null when the
 * test has no database address, and the caller then skips that check. Read-only by use: the tests only SELECT.
 */
export async function queryDb<T extends Record<string, unknown>>(text: string): Promise<T[] | null> {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) return null;
  if (typeof WebSocket !== "undefined") neonConfig.webSocketConstructor = WebSocket;
  const pool = new Pool({ connectionString: url });
  try {
    return (await pool.query(text)).rows as T[];
  } finally {
    await pool.end();
  }
}
