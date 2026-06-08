import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    "src/cli/index.ts",
    "src/index.ts",
    "src/**/*.test.ts",
    // Standalone task runners under scripts/ (executed via tsx) and their colocated
    // tests. Treating them as entries means script-only dependencies (e.g. `resend`,
    // used in scripts/security-scan-lib.ts) are seen as used instead of being reported
    // as false-positive unused dependencies.
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.ts", "scripts/**/*.ts"],
  ignore: [
    // Build output and node_modules
    "dist/**",
    "node_modules/**",
    // Temporary files during testing
    "**/test-temp/**",
    // Configuration files
    "tsconfig.json",
    "vitest.config.ts",
    ".oxfmtrc.json",
    ".rulesync/**",
    "docs/**",
  ],
  ignoreDependencies: [
    // Dependencies used only in configuration files
    "@secretlint/secretlint-rule-preset-recommend",
    // Used only in TypeScript configuration
    "typescript",
    "@types/node",
    "@types/js-yaml",
    // lint-staged is used in git hooks
    "lint-staged",
    // Used in docs site
    "vitepress",
  ],
  typescript: {
    config: "tsconfig.json",
  },
  includeEntryExports: true,
};

export default config;
