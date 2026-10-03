import { defineConfig } from "vitest/config";
import path from "node:path";

/** Evals call a real model (costs a few cents). Run with `npm run eval`; requires ANTHROPIC_API_KEY. */
export default defineConfig({
  resolve: { alias: { "@": path.resolve(import.meta.dirname, "src") } },
  test: { include: ["evals/**/*.eval.test.ts"], testTimeout: 90_000 },
});
