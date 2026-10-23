// One run through a deployed app, as Raghav, using whatever AI that deployment has (real Gemini when AI_CLIENT is unset).
//
//   E2E_BASE_URL=https://<preview> npm run smoke:preview
//
// It signs in with the e2e account from .e2e-credentials.local.json (created by `npm run e2e:reset`, test databases only),
// uploads the seed moved to today, keeps asking for the remaining AI decisions, and prints how it went. Nothing secret is printed.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { istDate } from "@/lib/dates/isoWeek";
import { shiftSeed } from "../tests/helpers/shiftSeed";

config({ path: ".env.local", quiet: true });

async function main() {
  const base = process.env.E2E_BASE_URL;
  if (!base) throw new Error("Set E2E_BASE_URL to the deployment to test.");
  const bypass = process.env.VERCEL_AUTOMATION_BYPASS_SECRET;
  const creds = JSON.parse(readFileSync(".e2e-credentials.local.json", "utf8")).raghav as { email: string; password: string };
  const headers: Record<string, string> = bypass ? { "x-vercel-protection-bypass": bypass } : {};

  const login = await fetch(`${base}/api/auth/login`, {
    method: "POST",
    headers: { ...headers, "content-type": "application/json" },
    body: JSON.stringify(creds),
  });
  if (!login.ok) throw new Error(`Sign-in failed (${login.status}).`);
  const cookie = (login.headers.get("set-cookie") ?? "").split(";")[0];
  const auth = { ...headers, cookie };

  const files = shiftSeed(istDate(new Date()));
  const form = new FormData();
  const names: Record<string, string> = { sales: "weekly_sales.csv", inventory: "current_inventory.csv", sku_master: "sku_master.csv", distributor_master: "distributor_master.csv", calendar: "calendar.csv" };
  for (const [key, name] of Object.entries(names)) form.append(key, new Blob([files[key as keyof typeof files]], { type: "text/csv" }), name);
  form.append("acknowledgeWarnings", "true");

  const t0 = Date.now();
  const res = await fetch(`${base}/api/runs`, { method: "POST", headers: auth, body: form });
  const first = await res.json();
  if (!res.ok) throw new Error(`Start run failed (${res.status}): ${first?.error?.message ?? "no message"}`);
  console.log(`Run ${first.runId}: ${first.flagCount} flags, ${first.remaining} decisions left after the first request (${Math.round((Date.now() - t0) / 1000)} s).`);

  let state = first as { runId: number; remaining: number; fallbackCount: number; fallbackWarning: boolean; status: string; flagCount: number };
  for (let i = 0; i < 20 && state.remaining > 0; i++) {
    const r = await fetch(`${base}/api/runs/${state.runId}/continue`, { method: "POST", headers: auth });
    state = await r.json();
    if (!r.ok) throw new Error(`Continue failed (${r.status}).`);
    console.log(`  carried on: ${state.remaining} left`);
  }
  console.log(`Done in ${Math.round((Date.now() - t0) / 1000)} s: status ${state.status}, ${state.fallbackCount} of ${state.flagCount} fallback, warning ${state.fallbackWarning}.`);
  if (state.remaining > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
