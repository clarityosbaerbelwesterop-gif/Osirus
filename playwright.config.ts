import path from "node:path";
import { defineConfig } from "@playwright/test";

// Projects:
//   smoke     -- the real sign-in page and the health endpoint
//   visual    -- screenshot comparison of the main surfaces
//   ui        -- responsive, keyboard, accessibility and the user journeys
// The UI suites run against /ui-fixtures, which the server only serves when
// OSIRUS_UI_FIXTURES=1 and never on a production deployment.
// PLAYWRIGHT_CHROMIUM_EXECUTABLE points at a preinstalled browser when the
// bundled one is not downloaded (local sandboxes); CI installs its own.

const executablePath = process.env.PLAYWRIGHT_CHROMIUM_EXECUTABLE;

export default defineConfig({
  testDir: "./e2e",
  outputDir: "test-results",
  snapshotPathTemplate: "{testDir}/__screenshots__/{arg}{ext}",
  fullyParallel: true,
  forbidOnly: Boolean(process.env.CI),
  retries: 0,
  reporter: process.env.CI
    ? [["list"], ["html", { open: "never", outputFolder: "playwright-report" }]]
    : "list",
  expect: {
    timeout: 10_000,
    toHaveScreenshot: {
      maxDiffPixelRatio: 0.01,
      animations: "disabled",
      caret: "hide",
      scale: "css",
      stylePath: path.join(__dirname, "e2e", "screenshot.css"),
    },
  },
  use: {
    baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000",
    trace: "retain-on-failure",
    screenshot: "only-on-failure",
    launchOptions: executablePath ? { executablePath } : {},
  },
  projects: [
    { name: "smoke", testMatch: /smoke\.spec\.ts/ },
    { name: "visual", testMatch: /visual\.spec\.ts/ },
    {
      name: "ui",
      testMatch: /(responsive|keyboard|a11y|journeys|performance)\.spec\.ts/,
    },
  ],
  webServer: {
    command: "npm run start -- --hostname 127.0.0.1",
    url: "http://127.0.0.1:3000",
    reuseExistingServer: !process.env.CI,
    env: { OSIRUS_UI_FIXTURES: "1" },
  },
});
