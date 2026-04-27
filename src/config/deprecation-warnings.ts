/**
 * One-shot deprecation warnings.
 *
 * Each guard is emitted at most once per Node.js process to avoid repeat logs
 * when the resolver is invoked from multiple commands within the same run, or
 * when a programmatic `new Config(...)` call triggers the same warning path.
 *
 * NOTE: Vitest runs all tests within a single Node process and does not
 * reset module state between test files by default, so the "once" guard
 * would carry across tests. Tests that need to assert on the warning must
 * call `resetDeprecationWarningForTests()` in a `beforeEach` hook.
 *
 * Warnings can be silenced by setting the `RULESYNC_SILENT_DEPRECATION`
 * environment variable so CI pipelines that intentionally run on the
 * deprecated form can opt out.
 */
let featuresObjectFormWarningEmitted = false;
let getBaseDirsWarningEmitted = false;
let baseDirsConfigFieldWarningEmitted = false;

export const emitFeaturesObjectFormDeprecationWarning = (): void => {
  if (featuresObjectFormWarningEmitted) return;
  if (process.env.RULESYNC_SILENT_DEPRECATION) return;
  featuresObjectFormWarningEmitted = true;
  // oxlint-disable-next-line no-console
  console.warn(
    "[rulesync] DEPRECATED: 'features' object form is deprecated. " +
      "Use the new 'targets' object form instead: " +
      "`targets: { claudecode: { rules: true, ignore: { fileMode: 'local' } } }`. " +
      "See https://github.com/dyoshikawa/rulesync/blob/main/docs/guide/configuration.md " +
      "for the migration guide.",
  );
};

export const emitGetBaseDirsDeprecationWarning = (): void => {
  if (getBaseDirsWarningEmitted) return;
  if (process.env.RULESYNC_SILENT_DEPRECATION) return;
  getBaseDirsWarningEmitted = true;
  // oxlint-disable-next-line no-console
  console.warn(
    "[rulesync] DEPRECATED: Config.getBaseDirs() is deprecated; " +
      "use Config.getOutputRoots() instead. " +
      "It will be removed in a future major release.",
  );
};

export const emitBaseDirsConfigFieldDeprecationWarning = (): void => {
  if (baseDirsConfigFieldWarningEmitted) return;
  if (process.env.RULESYNC_SILENT_DEPRECATION) return;
  baseDirsConfigFieldWarningEmitted = true;
  // oxlint-disable-next-line no-console
  console.warn(
    "[rulesync] DEPRECATED: 'baseDirs' config field is deprecated; " +
      "use 'outputRoots' instead. " +
      "It will be removed in a future major release.",
  );
};

/**
 * Test-only helper to reset the one-shot emission guards between test runs.
 * Throws in non-test environments so production bundles cannot accidentally
 * reset the guards.
 */
export const resetDeprecationWarningForTests = (): void => {
  if (process.env.NODE_ENV !== "test") {
    throw new Error(
      "resetDeprecationWarningForTests is a test-only helper; do not call it outside NODE_ENV=test.",
    );
  }
  featuresObjectFormWarningEmitted = false;
  getBaseDirsWarningEmitted = false;
  baseDirsConfigFieldWarningEmitted = false;
};
