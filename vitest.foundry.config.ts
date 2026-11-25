import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The Foundry cycle runner: real model, real sandbox, hours per cycle on a
// rate-limited free model. Only evals/foundry.eval.ts; never part of npm test.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Vitest 5 clears mock calls before each test by default; these tests
    // assert calls made while a module loads, as Vitest 3 kept them.
    clearMocks: false,
    environment: "node",
    include: ["evals/foundry.eval.ts"],
    testTimeout: 6 * 60 * 60 * 1000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
