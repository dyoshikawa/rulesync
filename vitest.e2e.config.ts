import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/e2e/**/*.spec.ts"],
    // E2E helpers spread `process.env` into the CLI child, so an exported
    // HERMES_HOME/KIMI_CODE_HOME would redirect global output away from the
    // pseudo-home the specs assert against. Specs that exercise the overrides
    // pass them explicitly per invocation.
    env: {
      HERMES_HOME: "",
      KIMI_CODE_HOME: "",
    },
    testTimeout: 60000, // E2E tests may take longer
    hookTimeout: 60000,
    watch: false,
    maxWorkers: 1,
    fileParallelism: false,
  },
});
