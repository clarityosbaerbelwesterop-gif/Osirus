import { defineConfig } from "@playwright/test";

// The production journey (issue #26 merge gate): a real browser against the
// live deployment. Manual only (.github/workflows/prod-journey.yml); never
// part of `npm run test:e2e`, which runs against local fixtures.
export default defineConfig({
  testDir: "./e2e-prod",
  outputDir: "test-results-prod",
  fullyParallel: false,
  workers: 1,
  retries: 0,
  timeout: 8 * 60_000,
  reporter: [["list"]],
  use: {
    baseURL: process.env.PROD_BASE_URL ?? "https://osirus.vercel.app",
    // A failure keeps a screenshot, never a trace: traces record request
    // bodies, and the repository's Action logs are public.
    screenshot: "only-on-failure",
    trace: "off",
    video: "off",
  },
});
