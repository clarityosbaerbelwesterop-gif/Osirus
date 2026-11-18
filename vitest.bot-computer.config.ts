import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// Bots' cloud computers against the real Vercel Sandbox. Only
// evals/bot-computer.eval.ts; never part of npm test.
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
    include: ["evals/bot-computer.eval.ts"],
    testTimeout: 10 * 60 * 1000,
  },
});
