import { defineConfig } from "vitest/config";
import { fileURLToPath } from "node:url";
export default defineConfig({
  test: { include: ["tests/**/*.test.ts"], testTimeout: 20000, fileParallelism: false },
  // "server-only" refuses to load outside a React server environment; tests run server code directly.
  resolve: { alias: { "server-only": fileURLToPath(new URL("./tests/server-only-stub.ts", import.meta.url)) } },
});
