import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts", "scripts/**/*.test.ts"],
    exclude: ["src/**/*.spec.ts"], // Exclude E2E tests
    // Neutralize the tool home overrides before any test module loads. They
    // change the paths `getSettablePaths` returns (and therefore the shared-file
    // keys derived at module load), so a developer who exports them — which the
    // Hermes and Kimi users this code targets are the most likely to do — would
    // otherwise see unrelated specs fail on `pnpm cicheck`. Specs that exercise
    // the overrides set them explicitly at runtime.
    env: {
      HERMES_HOME: "",
      KIMI_CODE_HOME: "",
    },
    typecheck: {
      enabled: false,
      include: ["src/**/*.test-d.ts"],
    },
    watch: false,
    coverage: {
      provider: "v8",
      include: ["src/**/*.ts"],
      exclude: ["src/**/*.test.ts", "src/**/*.spec.ts", "src/**/*.test-d.ts", "src/cli/index.ts"],
    },
  },
});
