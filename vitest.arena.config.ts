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
    environment: "node",
    include: ["evals/**/*.eval.ts"],
    testTimeout: 60 * 60 * 1000,
    hookTimeout: 120_000,
    fileParallelism: false,
  },
});
