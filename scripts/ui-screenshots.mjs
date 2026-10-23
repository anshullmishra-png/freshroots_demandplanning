// Saves screenshots of the check pages so a person can look at them. Needs a server built or started with UI_CHECK=1.
//   node scripts/ui-screenshots.mjs <output-folder> [baseUrl]
import { chromium } from "@playwright/test";
import { mkdirSync } from "node:fs";
import path from "node:path";

const out = process.argv[2];
const base = process.argv[3] ?? "http://localhost:3102";
if (!out) throw new Error("Usage: node scripts/ui-screenshots.mjs <output-folder> [baseUrl]");
mkdirSync(out, { recursive: true });

const shots = [
  ["review-raghav", "phone", { width: 375, height: 812 }],
  ["review-raghav", "desktop", { width: 1280, height: 900 }],
  ["orders-procurement", "phone", { width: 375, height: 812 }],
  ["dashboard-priya", "phone", { width: 375, height: 812 }],
  ["dashboard-killed-ceo", "desktop", { width: 1280, height: 900 }],
  ["kill-killed-deepa", "phone", { width: 375, height: 812 }],
];

const browser = await chromium.launch();
for (const [scene, name, viewport] of shots) {
  const context = await browser.newContext({ viewport, deviceScaleFactor: 1, isMobile: viewport.width < 500, hasTouch: viewport.width < 500 });
  const page = await context.newPage();
  await page.goto(`${base}/ui-check/${scene}`, { waitUntil: "networkidle" });
  const file = path.join(out, `${scene}-${name}.png`);
  await page.screenshot({ path: file, fullPage: false });
  console.log(file);
  await context.close();
}
await browser.close();
