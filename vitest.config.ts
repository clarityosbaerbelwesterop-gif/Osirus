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
  oxc: { jsx: { runtime: "automatic" } },
  test: {
    // Vitest 5 clears mock calls before each test by default; these tests
    // assert calls made while a module loads, as Vitest 3 kept them.
    clearMocks: false,
    environment: "node",
    include: ["tests/**/*.test.ts", "ai-lab/tests/**/*.test.ts"],
  },
});
