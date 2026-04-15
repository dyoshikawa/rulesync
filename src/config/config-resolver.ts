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
import { emitFeaturesObjectFormDeprecationWarning } from "./deprecation-warnings.js";

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

// Re-exported from `./deprecation-warnings.js` so existing test code that
// imports the helpers from this module keeps working. The helper itself
// lives in a separate module so `Config` (in `./config.js`) can also invoke
// it without creating a circular import on the resolver.
export { resetDeprecationWarningForTests } from "./deprecation-warnings.js";
export { emitFeaturesObjectFormDeprecationWarning };

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

    // Resolve features/targets while honouring the strict mutual-exclusivity
    // rule enforced by `assertTargetsFeaturesExclusive`:
    //
    // - When the user provides `targets` in object form, `features` must
    //   stay undefined (the per-target feature config lives inside the
    //   `targets` object itself); skip the `features` default.
    // - When the user provides `features` in object form without `targets`,
    //   leave `targets` undefined so `Config.getTargets` can derive the
    //   target list from the `features` object keys; skip the `targets`
    //   default.
    // - Otherwise fall through to the array-form defaults.
    const userProvidedFeatures = features ?? configByFile.features;
    const userProvidedTargets = targets ?? configByFile.targets;
    const targetsIsObject =
      userProvidedTargets !== undefined && !Array.isArray(userProvidedTargets);
    const featuresIsObject =
      userProvidedFeatures !== undefined && !Array.isArray(userProvidedFeatures);
    if (featuresIsObject) {
      emitFeaturesObjectFormDeprecationWarning();
    }
    const resolvedFeatures =
      userProvidedFeatures ?? (targetsIsObject ? undefined : getDefaults().features);
    const resolvedTargets =
      userProvidedTargets ?? (featuresIsObject ? undefined : getDefaults().targets);

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
