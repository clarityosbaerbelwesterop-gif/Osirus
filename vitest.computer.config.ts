import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The computer arm against the real Vercel Sandbox. Only
// evals/computer.eval.ts; never part of npm test.
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
    // Vitest 5 clears mock calls before each test by default; these tests
    // assert calls made while a module loads, as Vitest 3 kept them.
    clearMocks: false,
    environment: "node",
    include: ["evals/computer.eval.ts"],
    testTimeout: 15 * 60 * 1000,
  },
});
