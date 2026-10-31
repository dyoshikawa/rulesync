import { type KnipConfig } from "knip";

const config: KnipConfig = {
  entry: [
    // The `vp pack` entries (`pack.entry` in vite.config.ts): `src/cli/index.ts`
    // (package.json `bin`) and `src/index.ts` (package.json `exports`/`main`/
    // `module`). Knip has no plugin that reads `pack`, so they are listed here.
    "src/cli/index.ts",
    "src/index.ts",
    // The test files are kept explicit because they are not covered by an
    // enabled plugin's defaults.
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
    // Run by `vp lint`, which resolves it from the working directory first.
    "oxlint",
  ],
  // `vp test` is not a command Knip parses, so the E2E config the `test:e2e`
  // script passes with `--config` is named here.
  vitest: {
    config: ["vitest.config.ts", "vitest.e2e.config.ts"],
  },
  rules: {
    // `src/types/hooks.ts` intentionally aliases the OpenCode hook-event
    // constants for Kilo (`KILO_HOOK_EVENTS = OPENCODE_HOOK_EVENTS`,
    // `CANONICAL_TO_KILO_EVENT_NAMES = CANONICAL_TO_OPENCODE_EVENT_NAMES`)
    // because Kilo's hook model currently matches OpenCode's. Each name is
    // imported by its own tool integration, so the alias keeps the data DRY
    // while letting the two diverge later. knip flags these as duplicate
    // exports, so the rule is disabled rather than duplicating the literals.
    duplicates: "off",
  },
  // `includeEntryExports` is intentionally left at its default (false). Entry files
  // (the library `src/index.ts`, the CLI `src/cli/index.ts`, `scripts/**`, and test
  // files) expose exports that form their public surface — e.g. the library re-exports
  // `Feature`/`ToolTarget` for consumers — and must not be reported as unused. Unused
  // exports inside the rest of `src/**` are still reported because those files are not
  // entries.
};

export default config;
