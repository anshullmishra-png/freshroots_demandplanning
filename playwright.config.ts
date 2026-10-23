import { config } from "dotenv";
import { defineConfig, devices } from "@playwright/test";

config({ path: ".env.local", quiet: true });

const PORT = 3000;
// Set only to test a deployed preview. (APP_URL is the app's own setting and is in .env.local, so it cannot mean this.)
const EXTERNAL = process.env.E2E_BASE_URL;

export default defineConfig({
  testDir: "./tests/e2e",
  testIgnore: "ui-audit.spec.ts", // needs a UI_CHECK build: run it with `npm run test:ui`
  // One journey, one role after another, sharing one database: never in parallel.
  fullyParallel: false,
  workers: 1,
  timeout: 180_000,
  expect: { timeout: 20_000 },
  reporter: "list",
  use: {
    baseURL: EXTERNAL ?? `http://localhost:${PORT}`,
    timezoneId: "Asia/Kolkata",
    // A Vercel preview is behind Vercel's own sign-in. Its "Protection Bypass for Automation" secret lets the test in
    // (the second header makes Vercel set a cookie, so page loads after the first carry it too).
    extraHTTPHeaders: process.env.VERCEL_AUTOMATION_BYPASS_SECRET
      ? { "x-vercel-protection-bypass": process.env.VERCEL_AUTOMATION_BYPASS_SECRET, "x-vercel-set-bypass-cookie": "true" }
      : undefined,
  },
  projects: [{ name: "chromium", use: { ...devices["Desktop Chrome"] } }],
  // Against a deployed preview the preview's own settings apply (it must have AI_CLIENT=mock). Locally the app is built
  // and started here with the mock AI forced on, so a test run never calls Gemini or spends anything.
  webServer: EXTERNAL
    ? undefined
    : {
        command: "npm run build && npm run start",
        url: `http://localhost:${PORT}/api/health`,
        reuseExistingServer: false,
        timeout: 600_000,
        // Each mock answer takes 0.7 s and a request may work for 0.5 s, so the run needs a second request: the
        // browser's "carry on" loop gets exercised for real.
        env: {
          AI_CLIENT: "mock",
          AI_MOCK_DELAY_MS: "700",
          AI_STEP_BUDGET_SECONDS: "0.5",
          APP_URL: `http://localhost:${PORT}`,
          EMAIL_PROVIDER: "console",
        },
      },
});
