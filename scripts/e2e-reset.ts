// Puts a TEST database into the state the end-to-end test starts from, and creates its six accounts.
//
//   npm run e2e:reset -- --host <the database host>
//
// It DELETES every run, review, order, loss entry, kill event and audit entry. It exists for a throwaway database
// (local dev or the Neon preview branch) and refuses to touch anything that looks real:
//   - you must pass the database host on the command line, and it must match the connection string (no accidents)
//   - it refuses on a Vercel production environment
//   - it refuses if any account has an email that does not end in ".test"
// Passwords for the six accounts are generated here and written to .e2e-credentials.local.json (git-ignored). They are
// never printed. The database comes from E2E_DATABASE_URL, falling back to DATABASE_URL.
import { config } from "dotenv";
import { randomBytes } from "node:crypto";
import { writeFileSync } from "node:fs";
import { sql } from "drizzle-orm";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { ROLES } from "@/lib/auth/permissions";

config({ path: ".env.local", quiet: true });

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(name);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const url = process.env.E2E_DATABASE_URL ?? process.env.DATABASE_URL;
  if (!url) throw new Error("Set E2E_DATABASE_URL (or DATABASE_URL) to the test database.");
  if (process.env.VERCEL_ENV === "production") throw new Error("Refusing: this is a production environment.");
  const host = new URL(url).hostname;
  if (arg("--host") !== host) throw new Error(`Refusing: pass --host ${host} to confirm that this is the database you mean to wipe.`);
  process.env.DATABASE_URL = url; // the app's client reads this

  const { getDb, closeDb } = await import("@/db/client");
  const db = getDb();
  try {
    const existing = (await db.execute(sql`SELECT email FROM users`)).rows as Array<{ email: string }>;
    const real = existing.filter((u) => !u.email.toLowerCase().endsWith(".test"));
    if (real.length > 0) throw new Error(`Refusing: ${real.length} account(s) have a real-looking email. This is not a test database.`);

    await db.execute(
      sql`TRUNCATE email_outbox, kill_events, loss_entries, buying_decisions, reviews, ai_decisions, flags, runs, audit_log, weekly_sales, inventory, data_snapshots, login_attempts RESTART IDENTITY CASCADE`,
    );
    await db.execute(
      sql`INSERT INTO kill_state (id, kill1_state, kill2_state, kill1_epoch_start) VALUES (1, 'armed', 'green', now())
          ON CONFLICT (id) DO UPDATE SET kill1_state = 'armed', kill2_state = 'green', kill1_epoch_start = now(), updated_at = now()`,
    );

    const creds: Record<string, { email: string; password: string }> = {};
    for (const role of ROLES) {
      const email = `${role}@e2e.freshroots.test`;
      const password = randomBytes(12).toString("base64url");
      const passwordHash = await hashPassword(password);
      await db
        .insert(users)
        .values({ name: `E2E ${role}`, email, role, passwordHash })
        .onConflictDoUpdate({ target: users.email, set: { passwordHash, active: true, role } });
      creds[role] = { email, password };
    }
    writeFileSync(".e2e-credentials.local.json", JSON.stringify(creds, null, 2));
    console.log(`Reset ${host}. ${ROLES.length} accounts written to .e2e-credentials.local.json (not printed).`);
  } finally {
    await closeDb();
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
