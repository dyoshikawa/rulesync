import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    // `src/cli/index.ts` is auto-detected from the package.json `bin` field, so it
    // does not need to be listed here. The library entry and the test files are kept
    // explicit because they are not covered by an enabled plugin's defaults.
    "src/index.ts",
    "src/**/*.test.ts",
    // Standalone task runners under scripts/ (executed via tsx) and their colocated
    // tests. Treating them as entries means script-only dependencies (e.g. `resend`,
    // used in scripts/security-scan-lib.ts) are seen as used instead of being reported
    // as false-positive unused dependencies.
    "scripts/**/*.ts",
  ],
  project: ["src/**/*.ts", "scripts/**/*.ts"],
  ignoreDependencies: [
    // Dependencies used only in configuration files
    "@secretlint/secretlint-rule-preset-recommend",
    // Optional peer dependencies of `xsschema` (a transitive dependency via
    // `fastmcp`). They are not imported from our source, so knip reports them as
    // unused, but `xsschema` resolves them through dynamic `import()` and the
    // `bun build --compile` step statically bundles those imports. Dropping them
    // breaks the binary build, so they must stay installed and ignored here.
    "effect",
    "sury",
    "@valibot/to-json-schema",
  ],
  includeEntryExports: true,
};

export default config;
