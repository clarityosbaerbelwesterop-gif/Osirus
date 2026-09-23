import { fileURLToPath } from "node:url";
import { defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL("./src", import.meta.url)),
      // Server modules are exercised directly in tests; the "server-only"
      // guard is a bundler concern and resolves to an empty module here.
      "server-only": fileURLToPath(
        new URL("./evals/server-only-stub.ts", import.meta.url),
      ),
    },
  },
  // UI view models and the Markdown renderer are tested in node with
  // react-dom/server; JSX compiles with the automatic runtime.
  esbuild: { jsx: "automatic" },
  test: { environment: "node", include: ["tests/**/*.test.ts"] },
});
