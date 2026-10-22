// Simple secret scan over git-tracked and untracked-but-not-ignored files.
// Fails (exit 1) if anything looks like a real key. Prints file and line only, never the match.
import { execSync } from "node:child_process";
import { readFileSync } from "node:fs";

const PATTERNS = [
  ["Google API key", /AIza[0-9A-Za-z_-]{35}/],
  ["GitHub token", /\b(ghp|gho|ghu|ghs|ghr)_[0-9A-Za-z]{30,}\b/],
  ["GitHub fine-grained token", /github_pat_[0-9A-Za-z_]{40,}/],
  ["Generic sk- key", /\bsk-[0-9A-Za-z_-]{24,}\b/],
  ["Neon API key", /\bnapi_[0-9a-z]{30,}\b/],
  ["Postgres URL with password", /postgres(ql)?:\/\/[^\s:@/]+:[^\s:@/]+@/],
  ["Private key block", /-----BEGIN (RSA |EC |OPENSSH |)PRIVATE KEY-----/],
  ["Vercel token", /\bvercel_[0-9A-Za-z]{20,}\b/],
];

const SKIP = [/^package-lock\.json$/, /^scripts\/secret-scan\.mjs$/, /\.(png|jpg|jpeg|ico|svg|woff2?)$/];

const files = execSync("git ls-files --cached --others --exclude-standard", { encoding: "utf8" })
  .split(/\r?\n/)
  .filter((f) => f && !SKIP.some((re) => re.test(f)));

let hits = 0;
for (const file of files) {
  let text;
  try {
    text = readFileSync(file, "utf8");
  } catch {
    continue;
  }
  text.split(/\r?\n/).forEach((line, i) => {
    for (const [label, re] of PATTERNS) {
      if (re.test(line)) {
        console.error(`SECRET? ${label}: ${file}:${i + 1}`);
        hits++;
      }
    }
  });
}

if (hits > 0) {
  console.error(`\nSecret scan failed: ${hits} possible secret(s). Remove them and rotate the key.`);
  process.exit(1);
}
console.log(`Secret scan passed (${files.length} files checked).`);
