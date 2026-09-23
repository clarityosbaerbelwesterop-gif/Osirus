import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      // Server modules are exercised directly in tests; the "server-only"
      // guard is a bundler concern and resolves to an empty module here.
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
