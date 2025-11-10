import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    globals: true,
    environment: "node",
    include: ["src/e2e/**/*.spec.ts"],
    testTimeout: 60000, // E2E tests may take longer
    hookTimeout: 60000,
    watch: false,
    maxWorkers: 1,
    fileParallelism: false
  },
});
