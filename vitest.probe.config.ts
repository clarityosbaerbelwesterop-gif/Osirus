import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Live model probe: real calls with the deployment's keys, never part of
// `npm test`. Runs from the "Sync runtime configuration" workflow.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: {
    environment: "node",
    include: ["evals/**/*.probe.ts"],
    testTimeout: 15 * 60 * 1000,
    fileParallelism: false,
  },
});
