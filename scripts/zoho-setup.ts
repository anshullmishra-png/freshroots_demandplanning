// One-time Zoho Inventory setup. Nothing secret is printed.
//
//   exchange   Trade the one-time code (ZOHO_GRANT_CODE, from Zoho's API console, valid 10 minutes) for a permanent
//              refresh token. Needs ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET in .env.local. Writes ZOHO_REFRESH_TOKEN,
//              ZOHO_ORG_ID and ZOHO_DC into .env.local.
//   seed       Creates in Zoho the vendors (distributors) and items (SKUs) from seed/*.csv that are not there yet.
//              Safe to run again: it only adds what is missing. No prices are set; procurement sets those in Zoho.
//   check      Shows the organisation and how many vendors and items it has.
//
//   npx tsx scripts/zoho-setup.ts exchange | seed | check
import { config } from "dotenv";
import { existsSync, readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { createZohoClient, zohoConfigFromEnv, ZOHO_DATA_CENTRES, type ZohoDataCentre } from "@/lib/zoho/client";

config({ path: ".env.local", quiet: true });

function setEnvLine(file: string, name: string, value: string) {
  const text = existsSync(file) ? readFileSync(file, "utf8") : "";
  const lines = text.split(/\r?\n/);
  const i = lines.findIndex((l) => l.startsWith(`${name}=`));
  if (i >= 0) lines[i] = `${name}=${value}`;
  else {
    if (lines.at(-1) === "") lines.pop();
    lines.push(`${name}=${value}`, "");
  }
  writeFileSync(file, lines.join("\n"));
}

async function exchange() {
  const clientId = process.env.ZOHO_CLIENT_ID?.trim();
  const clientSecret = process.env.ZOHO_CLIENT_SECRET?.trim();
  const code = process.env.ZOHO_GRANT_CODE?.trim();
  const dc = (process.env.ZOHO_DC?.trim() || "in") as ZohoDataCentre;
  if (!clientId || !clientSecret) throw new Error("ZOHO_CLIENT_ID and ZOHO_CLIENT_SECRET must be in .env.local first.");
  if (!code) throw new Error("Set ZOHO_GRANT_CODE to the code from Zoho's API console.");
  if (!ZOHO_DATA_CENTRES.includes(dc)) throw new Error(`ZOHO_DC must be one of ${ZOHO_DATA_CENTRES.join(", ")}.`);

  const res = await fetch(`https://accounts.zoho.${dc}/oauth/v2/token`, {
    method: "POST",
    headers: { "content-type": "application/x-www-form-urlencoded" },
    body: new URLSearchParams({ grant_type: "authorization_code", client_id: clientId, client_secret: clientSecret, code }),
  });
  const body = (await res.json().catch(() => ({}))) as Record<string, unknown>;
  if (typeof body.refresh_token !== "string" || typeof body.access_token !== "string") {
    throw new Error(`Zoho did not accept the code (${String(body.error ?? res.status)}). Codes last 10 minutes and work once: generate a new one.`);
  }

  // Find the organisation with the access token we just got (needs the settings.READ scope).
  const orgs = await fetch(`https://www.zohoapis.${dc}/inventory/v1/organizations`, { headers: { authorization: `Zoho-oauthtoken ${body.access_token}` } });
  const orgJson = (await orgs.json().catch(() => ({}))) as { organizations?: Array<{ organization_id: string; name: string }>; message?: string };
  const list = orgJson.organizations ?? [];
  if (list.length === 0) throw new Error(`Zoho gave no organisation (${orgJson.message ?? orgs.status}). Is Inventory set up for this account?`);
  const org = list.find((o) => o.organization_id === process.env.ZOHO_ORG_ID) ?? list[0];

  const env = path.resolve(".env.local");
  setEnvLine(env, "ZOHO_REFRESH_TOKEN", body.refresh_token);
  setEnvLine(env, "ZOHO_ORG_ID", String(org.organization_id));
  setEnvLine(env, "ZOHO_DC", dc);
  console.log(`Connected to "${org.name}" (${list.length} organisation${list.length === 1 ? "" : "s"} on this account). Refresh token saved to .env.local, not printed.`);
}

const csv = (file: string) =>
  readFileSync(path.resolve("seed", file), "utf8")
    .split(/\r?\n/)
    .slice(1)
    .filter(Boolean)
    .map((l) => l.split(","));

/** Zoho only accepts its own list of units. */
const zohoUnit = (uom: string) => {
  const u = uom.trim().toLowerCase();
  if (["kg", "g", "mg", "lb", "l", "ml", "dz", "box", "m", "cm"].includes(u)) return u;
  return "pcs";
};

async function seed() {
  const cfg = zohoConfigFromEnv();
  if (!cfg) throw new Error("Zoho is not connected yet: run `exchange` first.");
  const client = createZohoClient(cfg);
  const [vendors, items] = await Promise.all([client.listVendors(), client.listItems()]);
  const haveVendor = new Set(vendors.map((v) => v.name.trim().toLowerCase()));
  const haveSku = new Set(items.map((i) => i.sku.trim().toLowerCase()).filter(Boolean));

  let v = 0;
  for (const [, name] of csv("distributor_master.csv")) {
    if (haveVendor.has(name.trim().toLowerCase())) continue;
    await client.createVendor(name.trim());
    v++;
  }
  let i = 0;
  for (const [sku, name, , , , uom] of csv("sku_master.csv")) {
    if (haveSku.has(sku.trim().toLowerCase())) continue;
    await client.createItem({ sku: sku.trim(), name: name.trim(), unit: zohoUnit(uom) });
    i++;
  }
  console.log(`Created ${v} vendor(s) and ${i} item(s) in Zoho. Already there: ${vendors.length} vendor(s), ${items.length} item(s).`);
}

async function check() {
  const cfg = zohoConfigFromEnv();
  if (!cfg) throw new Error("Zoho is not connected yet.");
  const client = createZohoClient(cfg);
  const [org, vendors, items] = await Promise.all([client.organization(), client.listVendors(), client.listItems()]);
  console.log(`Organisation "${org.name}": ${vendors.length} vendor(s), ${items.length} item(s).`);
}

const modes: Record<string, () => Promise<void>> = { exchange, seed, check };
const mode = process.argv[2];
if (!modes[mode ?? ""]) {
  console.error("Usage: npx tsx scripts/zoho-setup.ts exchange | seed | check");
  process.exit(1);
}
modes[mode]().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
