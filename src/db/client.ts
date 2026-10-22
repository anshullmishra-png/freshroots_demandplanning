import { Pool, neonConfig } from "@neondatabase/serverless";
import { drizzle } from "drizzle-orm/neon-serverless";
import * as schema from "./schema";

// Server-side only. The connection string comes from the environment and is never logged.
if (typeof WebSocket !== "undefined") {
  neonConfig.webSocketConstructor = WebSocket;
}

let pool: Pool | null = null;

export function getDb() {
  const url = process.env.DATABASE_URL ?? process.env.DATABASE_URL_UNPOOLED;
  if (!url) throw new Error("DATABASE_URL is not set. Add it to .env.local (see .env.example).");
  pool ??= new Pool({ connectionString: url });
  return drizzle(pool, { schema });
}

export async function closeDb() {
  await pool?.end();
  pool = null;
}
