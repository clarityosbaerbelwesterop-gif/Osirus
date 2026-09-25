import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

// The recursive-intelligence runners (M44–M48) for GitHub Actions: arena
// measurement, the software-RSI pipeline and the live lane. Never part of
// npm test. RSI_EVAL names the one runner a job executes.
export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  esbuild: { jsx: "automatic" },
  test: {
    environment: "node",
    include: [process.env.RSI_EVAL ?? "evals/rsi-measure.eval.ts"],
    testTimeout: 5 * 60 * 60 * 1000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
