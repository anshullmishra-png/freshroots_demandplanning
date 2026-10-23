// Creates the accounts (docs/12-OPEN-QUESTIONS.md, question 19): one per role, email + password sign-in.
//
//   npm run seed:users                 creates accounts from users.local.json (refuses to run without it)
//   npm run seed:users -- --demo       demo accounts (role@freshroots.test) when users.local.json is absent: never on production
//   npm run seed:users -- --reset      also gives existing accounts a new password
//
// users.local.json (git-ignored) is a list: [{ "name": "Raghav Kulkarni", "email": "raghav@example.com", "role": "raghav" }, ...]
// Passwords are generated here, shown nowhere on screen, and written to .seed-passwords.local.txt (git-ignored).
// Hand each person their password privately, and ask them to keep it safe. Nothing is committed or logged.
import { config } from "dotenv";
import { eq, sql } from "drizzle-orm";
import { randomBytes } from "node:crypto";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import { users } from "@/db/schema";
import { hashPassword } from "@/lib/auth/password";
import { ROLES, type Role } from "@/lib/auth/permissions";

config({ path: ".env.local", quiet: true });

interface Seed {
  name: string;
  email: string;
  role: Role;
}

function readSeeds(): { seeds: Seed[]; source: string } {
  if (existsSync("users.local.json")) {
    const parsed = JSON.parse(readFileSync("users.local.json", "utf8")) as Seed[];
    for (const s of parsed) {
      if (!s.name || !s.email?.includes("@") || !ROLES.includes(s.role)) {
        throw new Error(`users.local.json: bad entry ${JSON.stringify({ email: s.email, role: s.role })}`);
      }
    }
    return { seeds: parsed, source: "users.local.json" };
  }
  // Demo accounts have guessable emails. Creating them has to be asked for, so they cannot reach a real deployment by accident.
  if (!process.argv.includes("--demo")) {
    throw new Error(
      "users.local.json was not found. Create it with the real names and emails (see the comment at the top of this file), " +
        "or run with --demo to create throwaway demo accounts on a local or preview database.",
    );
  }
  const label = (r: Role) => r.charAt(0).toUpperCase() + r.slice(1);
  return {
    seeds: ROLES.map((role) => ({ name: `Demo ${label(role)}`, email: `${role}@freshroots.test`, role })),
    source: "demo accounts (no users.local.json found)",
  };
}

async function main() {
  const reset = process.argv.includes("--reset");
  const { seeds, source } = readSeeds();
  const { getDb, closeDb } = await import("@/db/client");
  const db = getDb();
  const lines: string[] = [];
  try {
    for (const s of seeds) {
      const email = s.email.trim().toLowerCase();
      const [existing] = await db.select().from(users).where(sql`lower(${users.email}) = ${email}`).limit(1);
      if (existing && existing.passwordHash && !reset) {
        console.log(`kept     ${email} (${existing.role})`);
        continue;
      }
      const password = randomBytes(12).toString("base64url"); // 16 characters
      const passwordHash = await hashPassword(password);
      if (existing) {
        await db.update(users).set({ name: s.name, role: s.role, passwordHash, active: true }).where(eq(users.id, existing.id));
        console.log(`updated  ${email} (${s.role})`);
      } else {
        await db.insert(users).values({ name: s.name, email, role: s.role, passwordHash });
        console.log(`created  ${email} (${s.role})`);
      }
      lines.push(`${email}\t${s.role}\t${password}`);
    }
  } finally {
    await closeDb();
  }
  if (lines.length > 0) {
    writeFileSync(".seed-passwords.local.txt", `# Generated passwords. Git-ignored. Share privately, then delete this file.\n${lines.join("\n")}\n`);
    console.log(`\nSource: ${source}. ${lines.length} new password(s) written to .seed-passwords.local.txt (not printed).`);
  } else {
    console.log(`\nSource: ${source}. No new passwords.`);
  }
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
