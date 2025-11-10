import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/**/*.test.ts"],
    exclude: ["src/**/*.spec.ts"], // Exclude E2E tests
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
