import { defineConfig, devices } from "@playwright/test";

// Browser checks for accessibility and layout (docs/13 Phase 7; run with `npm run test:ui`).
// It builds the app with UI_CHECK=1, which switches on the fixture pages under /ui-check, then serves that build.
// No database and no sign-in are needed. Two sizes: a desktop window and a phone.
const PORT = 3102;

export default defineConfig({
  testDir: "./tests/e2e",
  testMatch: "ui-audit.spec.ts",
  fullyParallel: true,
  reporter: "list",
  timeout: 60_000,
  use: { baseURL: `http://localhost:${PORT}`, timezoneId: "Asia/Kolkata", locale: "en-GB" },
  projects: [
    { name: "desktop", use: { ...devices["Desktop Chrome"], viewport: { width: 1280, height: 800 } } },
    { name: "phone", use: { ...devices["Desktop Chrome"], viewport: { width: 375, height: 812 }, isMobile: true, hasTouch: true, deviceScaleFactor: 2 } },
  ],
  webServer: {
    command: `npm run build && npm run start -- -p ${PORT}`,
    url: `http://localhost:${PORT}/login`,
    env: { UI_CHECK: "1" },
    // Locally an already-running UI_CHECK server (for example `next dev`) is reused for fast iteration. CI always builds fresh.
    reuseExistingServer: !process.env.CI,
    timeout: 300_000,
  },
});
