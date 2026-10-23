// Stages the demo from the seed data, through the app's own screens' API, as the real roles would:
// Raghav uploads the seed and starts a run, reviews it (5 accepted, 2 changed), procurement places the orders.
// It stops there, so a viewer can continue live: Priya enters a loss, the alert fires, the switch stops it, Deepa re-arms.
//
//   npm run e2e:reset -- --host <test database host>      (empties the TEST database and creates the six accounts)
//   E2E_BASE_URL=https://<demo address> npm run demo:stage
//
// Test databases only: it uses the end-to-end accounts. Nothing secret is printed.
import { config } from "dotenv";
import { readFileSync } from "node:fs";
import { istDate } from "@/lib/dates/isoWeek";
import { shiftSeed } from "../tests/helpers/shiftSeed";
import { queryDb } from "../tests/e2e/db";

config({ path: ".env.local", quiet: true });

const base = process.env.E2E_BASE_URL;
if (!base) throw new Error("Set E2E_BASE_URL to the deployment to stage.");
const creds = JSON.parse(readFileSync(".e2e-credentials.local.json", "utf8")) as Record<string, { email: string; password: string }>;
const extra: Record<string, string> = process.env.VERCEL_AUTOMATION_BYPASS_SECRET ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET } : {};

async function signIn(role: string): Promise<Record<string, string>> {
  const res = await fetch(`${base}/api/auth/login`, { method: "POST", headers: { ...extra, "content-type": "application/json" }, body: JSON.stringify(creds[role]) });
  if (!res.ok) throw new Error(`Sign-in as ${role} failed (${res.status}).`);
  return { ...extra, cookie: (res.headers.get("set-cookie") ?? "").split(";")[0] };
}

async function call(h: Record<string, string>, path: string, init: RequestInit = {}) {
  const res = await fetch(`${base}${path}`, { ...init, headers: { ...h, ...(init.body && typeof init.body === "string" ? { "content-type": "application/json" } : {}) } });
  const json = await res.json().catch(() => null);
  if (!res.ok) throw new Error(`${path} failed (${res.status}): ${json?.error?.message ?? "no message"}`);
  return json;
}

async function main() {
  const raghav = await signIn("raghav");
  const files = shiftSeed(istDate(new Date()));
  const form = new FormData();
  const names: Record<string, string> = { sales: "weekly_sales.csv", inventory: "current_inventory.csv", sku_master: "sku_master.csv", distributor_master: "distributor_master.csv", calendar: "calendar.csv" };
  for (const [key, name] of Object.entries(names)) form.append(key, new Blob([files[key as keyof typeof files]], { type: "text/csv" }), name);
  form.append("acknowledgeWarnings", "true");
  let run = await call(raghav, "/api/runs", { method: "POST", body: form });
  for (let i = 0; i < 20 && run.remaining > 0; i++) run = await call(raghav, `/api/runs/${run.runId}/continue`, { method: "POST" });
  console.log(`Run ${run.runId}: ${run.flagCount} flags, ${run.fallbackCount} fallback, status ${run.status}`);

  const rows = await queryDb<{ id: number; action: string; quantity: number; flag_types: string[]; standard_qty: number }>(
    `SELECT d.id, d.action::text AS action, d.quantity, f.flag_types, f.standard_qty FROM ai_decisions d JOIN flags f ON f.id = d.flag_id WHERE f.run_id = ${Number(run.runId)} ORDER BY d.id`,
  );
  if (!rows) throw new Error("The stage script needs database access (E2E_DATABASE_URL or DATABASE_URL) to read the decisions.");
  // Change the first one, accept the rest: a realistic week where the AI is overruled rarely.
  let changed = 0;
  for (const [i, d] of rows.entries()) {
    if (i < 1) {
      const reorder = d.action === "REORDER";
      await call(raghav, "/api/reviews", {
        method: "POST",
        body: JSON.stringify({
          aiDecisionId: d.id,
          outcome: "rejected",
          change: {
            flagTypes: d.flag_types,
            action: "REORDER",
            quantity: reorder ? d.quantity + 100 : d.standard_qty,
            reasonCode: reorder ? "WRONG_QUANTITY" : "WRONG_ACTION",
            reasonText: reorder ? "Distributor lead time is longer this month, so a larger first order." : "Festival demand will not wait for the next cycle.",
          },
        }),
      });
      changed++;
    } else {
      await call(raghav, "/api/reviews", { method: "POST", body: JSON.stringify({ aiDecisionId: d.id, outcome: "accepted" }) });
    }
  }
  console.log(`Reviewed ${rows.length}: ${rows.length - changed} accepted, ${changed} changed.`);

  const procurement = await signIn("procurement");
  const orders = await queryDb<{ id: number }>(`SELECT id FROM buying_decisions WHERE status = 'pending' ORDER BY id`);
  if (orders && orders.length > 0) {
    await call(procurement, "/api/orders/place", { method: "POST", body: JSON.stringify({ ids: orders.map((o) => o.id), orderReference: "PO-DEMO-001" }) });
    console.log(`Procurement placed ${orders.length} orders.`);
  }
  console.log("Staged. Next, live: Priya enters a loss on the Dashboard.");
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
