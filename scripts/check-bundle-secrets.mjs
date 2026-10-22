// Run after `next build`. Fails if a secret could be in what the browser downloads (guardrails G-A7, G-S1).
//  1. The client bundle (.next/static) must not mention any secret environment variable by name.
//  2. No secret VALUE (from the environment or .env.local) may appear anywhere in the build output.
// It prints names and file paths only, never a value.
import { existsSync, readFileSync, readdirSync, statSync } from "node:fs";
import path from "node:path";

const SECRET_NAME = /(KEY|SECRET|TOKEN|PASSWORD|DATABASE_URL)/i;
const NAMES_FORBIDDEN_IN_CLIENT = [
  "GEMINI_API_KEY",
  "DATABASE_URL",
  "AUTH_SECRET",
  "CRON_SECRET",
  "EMAIL_API_KEY",
  "ZOHO_CLIENT_SECRET",
  "ZOHO_REFRESH_TOKEN",
];

function walk(dir) {
  if (!existsSync(dir)) return [];
  return readdirSync(dir).flatMap((f) => {
    const p = path.join(dir, f);
    return statSync(p).isDirectory() ? walk(p) : [p];
  });
}

function loadEnvLocal() {
  const out = {};
  if (!existsSync(".env.local")) return out;
  for (const line of readFileSync(".env.local", "utf8").split(/\r?\n/)) {
    const m = /^([A-Z0-9_]+)=(.*)$/.exec(line.trim());
    if (m) out[m[1]] = m[2];
  }
  return out;
}

if (!existsSync(".next")) {
  console.error("No .next folder. Run `npm run build` first.");
  process.exit(1);
}

const values = new Map(); // value -> variable name
for (const [name, value] of Object.entries({ ...loadEnvLocal(), ...process.env })) {
  if (value && value.length >= 8 && SECRET_NAME.test(name)) values.set(value, name);
}

let hits = 0;
for (const file of walk(path.join(".next", "static"))) {
  const text = readFileSync(file, "utf8");
  for (const name of NAMES_FORBIDDEN_IN_CLIENT) {
    if (text.includes(name)) {
      console.error(`CLIENT BUNDLE mentions ${name}: ${file}`);
      hits++;
    }
  }
}
for (const file of [...walk(path.join(".next", "static")), ...walk(path.join(".next", "server"))]) {
  if (!/\.(js|mjs|cjs|json|html|rsc|map|txt|css)$/.test(file)) continue;
  const text = readFileSync(file, "utf8");
  for (const [value, name] of values) {
    if (text.includes(value)) {
      console.error(`SECRET VALUE of ${name} found in build output: ${file}`);
      hits++;
    }
  }
}

if (hits > 0) {
  console.error(`\nBundle secret check failed: ${hits} problem(s).`);
  process.exit(1);
}
console.log(`Bundle secret check passed (${values.size} secret value(s) searched for).`);
