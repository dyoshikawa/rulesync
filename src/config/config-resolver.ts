import { dirname, join, resolve } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import {
  fileExists,
  getHomeDirectory,
  readFileContent,
  resolvePath,
  validateBaseDir,
} from "../utils/file.js";
import {
  assertTargetsFeaturesExclusive,
  Config,
  ConfigFile,
  ConfigFileSchema,
  ConfigParams,
  PartialConfigParams,
  RequiredConfigParams,
} from "./config.js";

/**
 * CLI-resolvable params exclude `sources` — sources are config-file-only.
 */
export type ConfigResolverResolveParams = Partial<
  Omit<ConfigParams, "sources"> & {
    configPath: string;
  }
>;

const getDefaults = (): RequiredConfigParams & { configPath: string } => ({
  targets: ["agentsmd"],
  features: ["rules"],
  verbose: false,
  delete: false,
  baseDirs: [process.cwd()],
  configPath: RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  global: false,
  silent: false,
  simulateCommands: false,
  simulateSubagents: false,
  simulateSkills: false,
  gitignoreTargetsOnly: true,
  dryRun: false,
  check: false,
  sources: [],
});

const loadConfigFromFile = async (filePath: string): Promise<PartialConfigParams> => {
  if (!(await fileExists(filePath))) {
    return {};
  }
  const fileContent = await readFileContent(filePath);
  const jsonData = parseJsonc(fileContent);
  // Parse with ConfigFileSchema to allow $schema property, then extract config params
  const parsed: ConfigFile = ConfigFileSchema.parse(jsonData);
  // Exclude $schema from config params
  const { $schema: _schema, ...configParams } = parsed;
  // Enforce mutual-exclusivity between object-form `targets` and
  // `features` on the user-authored file (before defaults are merged).
  assertTargetsFeaturesExclusive({
    targets: configParams.targets,
    features: configParams.features,
  });
  return configParams;
};

/**
 * One-shot deprecation warning for the object form under `features`.
 * Emitted once per process to avoid repeat logs when the resolver is
 * invoked from multiple commands within the same run. Skipped in tests to
 * keep test output clean — tests that need to assert on the warning should
 * import and call `emitFeaturesObjectFormDeprecationWarning` directly.
 */
let deprecationWarningEmitted = false;
export const emitFeaturesObjectFormDeprecationWarning = (): void => {
  if (deprecationWarningEmitted) return;
  deprecationWarningEmitted = true;
  // oxlint-disable-next-line no-console
  console.warn(
    "[rulesync] DEPRECATED: 'features' object form is deprecated. " +
      "Use the new 'targets' object form instead: " +
      "`targets: { claudecode: { rules: true, ignore: { fileMode: 'local' } } }`.",
  );
};
// Exposed for tests to reset state between runs.
export const resetDeprecationWarningForTests = (): void => {
  deprecationWarningEmitted = false;
};

const mergeConfigs = (
  baseConfig: PartialConfigParams,
  localConfig: PartialConfigParams,
): PartialConfigParams => {
  // Local config takes precedence over base config
  // Only override if the value is explicitly set (not undefined)
  return {
    targets: localConfig.targets ?? baseConfig.targets,
    features: localConfig.features ?? baseConfig.features,
    verbose: localConfig.verbose ?? baseConfig.verbose,
    delete: localConfig.delete ?? baseConfig.delete,
    baseDirs: localConfig.baseDirs ?? baseConfig.baseDirs,
    global: localConfig.global ?? baseConfig.global,
    silent: localConfig.silent ?? baseConfig.silent,
    simulateCommands: localConfig.simulateCommands ?? baseConfig.simulateCommands,
    simulateSubagents: localConfig.simulateSubagents ?? baseConfig.simulateSubagents,
    simulateSkills: localConfig.simulateSkills ?? baseConfig.simulateSkills,
    gitignoreTargetsOnly: localConfig.gitignoreTargetsOnly ?? baseConfig.gitignoreTargetsOnly,
    dryRun: localConfig.dryRun ?? baseConfig.dryRun,
    check: localConfig.check ?? baseConfig.check,
    sources: localConfig.sources ?? baseConfig.sources,
  };
};

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve({
    targets,
    features,
    verbose,
    delete: isDelete,
    baseDirs,
    configPath = getDefaults().configPath,
    global,
    silent,
    simulateCommands,
    simulateSubagents,
    simulateSkills,
    gitignoreTargetsOnly,
    dryRun,
    check,
  }: ConfigResolverResolveParams): Promise<Config> {
    // Validate configPath to prevent path traversal attacks
    const validatedConfigPath = resolvePath(configPath, process.cwd());

    // Load base config (rulesync.jsonc)
    const baseConfig = await loadConfigFromFile(validatedConfigPath);

    // Load local config (rulesync.local.jsonc) from the same directory as the base config
    const configDir = dirname(validatedConfigPath);
    const localConfigPath = join(configDir, RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH);
    const localConfig = await loadConfigFromFile(localConfigPath);

    // Merge configs: local config takes precedence over base config
    // Priority: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
    const configByFile = mergeConfigs(baseConfig, localConfig);

    const resolvedGlobal = global ?? configByFile.global ?? getDefaults().global;
    const resolvedSimulateCommands =
      simulateCommands ?? configByFile.simulateCommands ?? getDefaults().simulateCommands;
    const resolvedSimulateSubagents =
      simulateSubagents ?? configByFile.simulateSubagents ?? getDefaults().simulateSubagents;

    const resolvedSimulateSkills =
      simulateSkills ?? configByFile.simulateSkills ?? getDefaults().simulateSkills;
    const resolvedGitignoreTargetsOnly =
      gitignoreTargetsOnly ??
      configByFile.gitignoreTargetsOnly ??
      getDefaults().gitignoreTargetsOnly;

    // Resolve features/targets with awareness of the deprecated
    // `features` object form: when the user provides `features` in object
    // form *without* `targets`, derive the target list from the features
    // object keys instead of falling through to the default `["agentsmd"]`.
    // This preserves the user's intent under the new strict schema where
    // setting both together is rejected.
    const resolvedFeatures = features ?? configByFile.features ?? getDefaults().features;
    const userProvidedTargets = targets ?? configByFile.targets;
    const featuresIsObject = resolvedFeatures !== undefined && !Array.isArray(resolvedFeatures);
    if (featuresIsObject) {
      emitFeaturesObjectFormDeprecationWarning();
    }
    const resolvedTargets =
      userProvidedTargets ??
      (featuresIsObject
        ? // eslint-disable-next-line no-type-assertion/no-type-assertion
          (Object.keys(resolvedFeatures as Record<string, unknown>) as ConfigParams["targets"])
        : getDefaults().targets);

    const configParams = {
      targets: resolvedTargets,
      features: resolvedFeatures,
      verbose: verbose ?? configByFile.verbose ?? getDefaults().verbose,
      delete: isDelete ?? configByFile.delete ?? getDefaults().delete,
      baseDirs: getBaseDirsInLightOfGlobal({
        baseDirs: baseDirs ?? configByFile.baseDirs ?? getDefaults().baseDirs,
        global: resolvedGlobal,
      }),
      global: resolvedGlobal,
      silent: silent ?? configByFile.silent ?? getDefaults().silent,
      simulateCommands: resolvedSimulateCommands,
      simulateSubagents: resolvedSimulateSubagents,
      simulateSkills: resolvedSimulateSkills,
      gitignoreTargetsOnly: resolvedGitignoreTargetsOnly,
      dryRun: dryRun ?? configByFile.dryRun ?? getDefaults().dryRun,
      check: check ?? configByFile.check ?? getDefaults().check,
      sources: configByFile.sources ?? getDefaults().sources,
    };
    return new Config(configParams);
  }
}

function getBaseDirsInLightOfGlobal({
  baseDirs,
  global,
}: {
  baseDirs: string[];
  global: boolean;
}): string[] {
  if (global) {
    // When global is true, the base directory is always the home directory
    return [getHomeDirectory()];
  }

  const resolvedBaseDirs = baseDirs.map((baseDir) => resolve(baseDir));

  // Validate each baseDir for security
  resolvedBaseDirs.forEach((baseDir) => {
    validateBaseDir(baseDir);
  });

  return resolvedBaseDirs;
}
