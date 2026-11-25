import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Agent Arena: live model evals. Never part of `npm test` -- it spends
// real model budget, so it runs only from the live-evals workflow.
export default defineConfig({
  resolve: {
    alias: {
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    // Vitest 5 clears mock calls before each test by default; these tests
    // assert calls made while a module loads, as Vitest 3 kept them.
    clearMocks: false,
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 230 * 60 * 1000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
