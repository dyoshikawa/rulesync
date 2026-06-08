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
    // Optional peer dependencies of `xsschema` (a transitive dependency via
    // `fastmcp`). They are not imported from our source, so knip reports them as
    // unused, but `xsschema` resolves them through dynamic `import()` and the
    // `bun build --compile` step statically bundles those imports. Dropping them
    // breaks the binary build, so they must stay installed and ignored here.
    "effect",
    "sury",
    "@valibot/to-json-schema",
  ],
  typescript: {
    config: "tsconfig.json",
  },
  includeEntryExports: true,
};

export default config;
