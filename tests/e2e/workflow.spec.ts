// docs/10-TEST-PLAN.md section H: the whole journey through the real screens, one role after another.
//
//   npm run e2e:reset -- --host <test database host>     (once per run: wipes the TEST database, writes the accounts)
//   npm run test:e2e                                       (builds, starts the app with the mock AI, runs this)
//   E2E_BASE_URL=https://<preview> npm run test:e2e        (against a deployed preview that has AI_CLIENT=mock)
//
// The seed files are moved to today's date first, because the app refuses inventory more than 7 days old.
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";
import { expect, test, type Browser, type Page } from "@playwright/test";
import { istDate } from "@/lib/dates/isoWeek";
import { shiftSeed } from "../helpers/shiftSeed";
import { queryDb } from "./db";

const CRED_FILE = path.resolve(process.env.E2E_CREDENTIALS ?? ".e2e-credentials.local.json");
const creds: Record<string, { email: string; password: string }> = existsSync(CRED_FILE) ? JSON.parse(readFileSync(CRED_FILE, "utf8")) : {};
const files = shiftSeed(istDate(new Date()));

const UPLOADS: Array<[string, keyof typeof files, string]> = [
  ["Weekly sales file", "sales", "weekly_sales.csv"],
  ["Current inventory file", "inventory", "current_inventory.csv"],
  ["SKU master file", "sku_master", "sku_master.csv"],
  ["Distributor master file", "distributor_master", "distributor_master.csv"],
  ["Calendar file", "calendar", "calendar.csv"],
];

test.describe.configure({ mode: "serial" });
test.skip(Object.keys(creds).length === 0, `No ${path.basename(CRED_FILE)}. Run: npm run e2e:reset -- --host <test database host>`);

async function signIn(browser: Browser, role: string): Promise<Page> {
  const context = await browser.newContext();
  const page = await context.newPage();
  const c = creds[role];
  // The form is a React form: wait until it is live, or a submit before that would be a plain browser POST.
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.goto("/login");
    await page.waitForLoadState("networkidle");
    await page.getByLabel("Email").fill(c.email);
    await page.getByLabel("Password").fill(c.password);
    await page.getByRole("button", { name: "Sign in" }).click();
    try {
      await page.waitForURL((u) => !u.pathname.startsWith("/login"), { timeout: 15_000 });
      return page;
    } catch {
      // try again
    }
  }
  throw new Error(`Could not sign in as ${role}`);
}

const progress = (page: Page, done: number, total: number) => expect(page.locator("p", { hasText: new RegExp(`^${done} of ${total}$`) })).toBeVisible();

test("H1. Raghav uploads the five seed files, starts a run, and sees 7 flags", async ({ browser }) => {
  const page = await signIn(browser, "raghav");
  await expect(page).toHaveURL(/\/review/);
  await page.goto("/run/new");
  await page.waitForLoadState("networkidle");
  for (const [label, key, name] of UPLOADS) {
    await page.getByLabel(label).setInputFiles({ name, mimeType: "text/csv", buffer: Buffer.from(files[key]) });
  }
  await page.getByRole("button", { name: "Check files" }).click();
  await expect(page.getByText("No errors. The files can be used.")).toBeVisible();
  const ack = page.getByLabel("I have read the warnings");
  if (await ack.count()) await ack.check();
  // Locally the mock is slow and the time budget short, so the first request cannot finish the run and the screen
  // must ask for the rest (docs/12 Q52). A preview needs the same two settings and E2E_EXPECT_RESUME=1.
  const resumeExpected = !process.env.E2E_BASE_URL || process.env.E2E_EXPECT_RESUME === "1";
  const continued = resumeExpected ? page.waitForResponse((r) => /\/api\/runs\/\d+\/continue$/.test(r.url()), { timeout: 60_000 }) : null;
  await page.getByRole("button", { name: /Start run/ }).click();
  if (continued) expect((await continued).status()).toBe(200);
  await page.waitForURL(/\/review\?run=\d+/, { timeout: 150_000 });
  await expect(page.getByRole("heading", { name: "Review AI decisions" })).toBeVisible();
  await expect(page.locator("article[aria-label^='SKU']")).toHaveCount(7);
  await progress(page, 0, 7);
  await page.context().close();
});

test("H2. Raghav accepts 5 and rejects 2 with reasons, and the run completes", async ({ browser }) => {
  const page = await signIn(browser, "raghav");
  await page.goto("/review");
  await progress(page, 0, 7);
  let done = 0;
  for (let i = 0; i < 2; i++) {
    const card = page.locator("article:has(button:has-text('Reject'))").first();
    await card.getByRole("button", { name: "Reject" }).click();
    const panel = card.getByRole("group", { name: /^Reject SKU/ });
    const qty = panel.getByLabel("Quantity (units)");
    if (await qty.isEnabled()) {
      await qty.fill(String(Number(await qty.inputValue()) + 100));
      await panel.getByLabel("Reason").selectOption("WRONG_QUANTITY");
    } else {
      // A hold turned into a reorder: still an order for procurement, and still a reversal.
      await panel.getByLabel("Action").selectOption("REORDER");
      await panel.getByLabel("Reason").selectOption("WRONG_ACTION");
    }
    await panel.getByRole("button", { name: "Save rejection" }).click();
    await progress(page, ++done, 7);
  }
  for (let i = 0; i < 5; i++) {
    await page.locator("article:has(button:has-text('Accept'))").first().getByRole("button", { name: "Accept" }).click();
    await progress(page, ++done, 7);
  }
  await expect(page.getByText("Every decision in this run has a review.")).toBeVisible();
  await expect(page.getByText("2 rejected", { exact: true })).toBeVisible();
  await expect(page.getByText("5 accepted", { exact: true })).toBeVisible();
  await page.context().close();
});

test("H3. Procurement sees 7 buying decisions and marks them placed", async ({ browser }) => {
  const page = await signIn(browser, "procurement");
  await expect(page).toHaveURL(/\/orders/);
  await expect(page.getByText("7 pending", { exact: true })).toBeVisible();
  await page.getByRole("button", { name: "Select all pending (7)" }).click();
  await page.getByRole("button", { name: "Mark 7 selected as placed" }).click();
  await expect(page.getByText("7 placed", { exact: true })).toBeVisible();
  await expect(page.getByText("0 pending", { exact: true })).toBeVisible();
  await page.context().close();
});

test("H4. Priya enters Rs 29,00,000: the alert shows and the emails are queued", async ({ browser }) => {
  const page = await signIn(browser, "priya");
  await expect(page).toHaveURL(/\/dashboard/);
  await page.getByLabel("Stockout lost sales (Rs)").fill("2000000");
  await page.getByLabel("Overstock write-off (Rs)").fill("900000");
  await page.getByRole("button", { name: "Save entry" }).click();
  await expect(page.getByText(/29,00,000.*above the alert level\. An alert was sent/)).toBeVisible();
  await expect(page.getByRole("status").filter({ hasText: "Loss alert" })).toBeVisible();

  const queued = await queryDb<{ to_email: string }>(`SELECT to_email FROM email_outbox WHERE kind = 'kill2.alert'`);
  if (queued) {
    const to = queued.map((r) => r.to_email);
    for (const role of ["raghav", "deepa", "ceo"]) expect(to).toContain(creds[role].email);
    expect(to).not.toContain(creds.procurement.email);
  } else test.info().annotations.push({ type: "note", description: "No database access from the test: the email queue was not checked." });
  await page.context().close();
});

test("H5. Priya adds Rs 6,00,000 (total Rs 35,00,000): Kill 2 fires, the banner is everywhere, new runs are blocked", async ({ browser }) => {
  const priya = await signIn(browser, "priya");
  // The same period twice is refused ("Edit it instead"), so the second figure is for the quarter's last month.
  const end = await priya.getByLabel("Period end").inputValue();
  await priya.getByLabel("Period start").fill(`${end.slice(0, 8)}01`);
  await priya.getByLabel("Stockout lost sales (Rs)").fill("600000");
  await priya.getByLabel("Overstock write-off (Rs)").fill("0");
  await priya.getByRole("button", { name: "Save entry" }).click();
  await expect(priya.getByText(/35,00,000.*Kill 2 has stopped the automation/)).toBeVisible();
  await priya.context().close();

  // The banner shows on a page of every role.
  const stop = "Automation stopped (Kill 2). Use the previous process.";
  for (const [role, route] of [["raghav", "/review"], ["procurement", "/orders"], ["deepa", "/dashboard"], ["ceo", "/dashboard"], ["admin", "/dashboard"], ["priya", "/dashboard"]] as const) {
    const page = await signIn(browser, role);
    await page.goto(route);
    await expect(page.getByRole("alert").filter({ hasText: stop })).toBeVisible();
    await page.context().close();
  }

  // A new run is disabled on the screen, and refused by the server.
  const raghav = await signIn(browser, "raghav");
  await raghav.goto("/run/new");
  await expect(raghav.getByText("A new run cannot start until it is re-armed.")).toBeVisible();
  await expect(raghav.getByRole("button", { name: "Check files" })).toBeDisabled();
  const refused = await raghav.request.post("/api/runs", {
    multipart: Object.fromEntries(UPLOADS.map(([, key, name]) => [key, { name, mimeType: "text/csv", buffer: Buffer.from(files[key]) }])),
  });
  expect(refused.status()).toBe(409);
  expect((await refused.json()).error.code).toBe("AUTOMATION_STOPPED");
  await raghav.context().close();

  const kill = await queryDb<{ kind: string }>(`SELECT kind FROM email_outbox WHERE kind = 'kill2.killed'`);
  if (kill) expect(kill.length).toBeGreaterThanOrEqual(3);
});

test("H6. Deepa re-arms with a written reason, and the audit log shows every step", async ({ browser }) => {
  const page = await signIn(browser, "deepa");
  await page.goto("/kill");
  const form = page.locator("form", { hasText: "Re-arm Kill 2" });
  await form.getByLabel(/Why is it safe to continue/).fill("Reviewed the loss entries with Priya; continuing under daily watch.");
  await form.getByLabel(/I understand Kill 2 will fire again/).check();
  await form.getByRole("button", { name: "Re-arm Kill 2" }).click();
  // Re-armed: the stop banner is gone; the quarter is still over the alert level, so the alert strip shows.
  await expect(page.getByRole("status").filter({ hasText: "Loss alert" })).toBeVisible();
  await expect(page.getByRole("alert").filter({ hasText: "Automation stopped" })).toHaveCount(0);

  const expected: Array<[string, number | null]> = [
    ["snapshot.uploaded", 1],
    ["run.created", 1],
    ["run.ai_done", 1],
    ["review.accepted", 5],
    ["review.rejected", 2],
    ["buying_decision.placed", null], // one entry per decision or per batch: at least one
    ["loss_entry.created", 2],
    ["kill2.alert", 1],
    ["kill2.fired", 1],
    ["kill.rearmed", 1],
  ];
  for (const [action, n] of expected) {
    await page.goto(`/audit?action=${encodeURIComponent(action)}`);
    const summary = page.getByText(/^\d+ entr(y|ies) · page 1 of \d+$/);
    await expect(summary, `audit: ${action}`).toBeVisible();
    const text = (await summary.textContent()) ?? "";
    const found = Number(/^(\d+)/.exec(text)![1]);
    if (n === null) expect(found, `audit: ${action}`).toBeGreaterThanOrEqual(1);
    else expect(found, `audit: ${action}`).toBe(n);
  }
  await page.context().close();
});

test("security: headers are on, and the sixth wrong password is locked out", async ({ browser, request }) => {
  const res = await request.get("/login");
  const h = res.headers();
  expect(h["x-content-type-options"]).toBe("nosniff");
  expect(h["x-frame-options"]).toBe("DENY");
  expect(h["referrer-policy"]).toBe("strict-origin-when-cross-origin");
  expect(h["content-security-policy"]).toContain("frame-ancestors 'none'");
  expect(h["x-powered-by"]).toBeUndefined();

  const email = "lockout-check@e2e.freshroots.test";
  const attempt = () => request.post("/api/auth/login", { data: { email, password: "definitely-wrong" } });
  for (let i = 0; i < 5; i++) expect((await attempt()).status()).toBe(401);
  const locked = await attempt();
  expect(locked.status()).toBe(429);
  expect(Number(locked.headers()["retry-after"])).toBeGreaterThan(0);
  void browser;
});
