import { defineConfig } from "@playwright/test";
export default defineConfig({
  testDir: "./e2e",
  use: { baseURL: process.env.PLAYWRIGHT_BASE_URL ?? "http://127.0.0.1:3000" },
  webServer: process.env.CI
    ? {
        command: "npm run start",
        url: "http://127.0.0.1:3000",
        reuseExistingServer: false,
      }
    : undefined,
});
