import { dirname, join, resolve } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
} from "../constants/rulesync-paths.js";
import {
  ALL_TOOL_TARGETS,
  type ToolTarget,
  isRulesyncConfigTargetsObject,
  type RulesyncConfigTargets,
} from "../types/tool-targets.js";
import {
  fileExists,
  getHomeDirectory,
  readFileContent,
  resolvePath,
  validateOutputRoot,
} from "../utils/file.js";
import { type Logger, warnWithFallback } from "../utils/logger.js";
import {
  assertTargetsFeaturesExclusive,
  Config,
  ConfigFile,
  ConfigFileSchema,
  ConfigParams,
  expandWildcardTargets,
  PartialConfigParams,
  RequiredConfigParams,
} from "./config.js";
import {
  emitAntigravityAliasDeprecationWarning,
  emitBaseDirsConfigFieldDeprecationWarning,
  emitFeaturesObjectFormDeprecationWarning,
} from "./deprecation-warnings.js";

/**
 * CLI-resolvable params exclude `sources` — sources are config-file-only.
 *
 * `baseDirs` is a deprecated alias for `outputRoots` accepted at the resolver
 * boundary for backward compatibility. When provided, the resolver emits a
 * one-shot deprecation warning and maps it to `outputRoots`. If both are
 * present, `outputRoots` wins. Will be removed in a future major release.
 */
export type ConfigResolverResolveParams = Partial<
  Omit<ConfigParams, "sources"> & {
    configPath: string;
    /** @deprecated Use `outputRoots` instead. */
    baseDirs: string[];
  }
>;

// `inputRoot` is intentionally optional — it is the only field with no
// project-default value, since omitting it means "use CWD". All other fields
// are concrete defaults so callers (and the resolver) can rely on
// `getDefaults().<field>` being populated.
type ConfigDefaults = Omit<RequiredConfigParams, "inputRoot"> & {
  inputRoot?: string;
  configPath: string;
};

const getDefaults = (): ConfigDefaults => ({
  targets: ["agentsmd"],
  features: ["rules"],
  verbose: false,
  delete: false,
  outputRoots: [process.cwd()],
  configPath: RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  global: false,
  silent: false,
  simulateCommands: false,
  simulateSubagents: false,
  simulateSkills: false,
  gitignoreTargetsOnly: true,
  gitignoreDestination: "gitignore",
  dryRun: false,
  check: false,
  inputRoot: undefined,
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
  const { $schema: _schema, baseDirs: deprecatedBaseDirs, ...configParams } = parsed;
  // Map the deprecated `baseDirs` field to the canonical `outputRoots`.
  // If both are present, `outputRoots` wins (consistent with the precedence
  // rule documented at the resolver boundary). Either way, emit a one-shot
  // deprecation warning so users know to migrate.
  if (deprecatedBaseDirs !== undefined) {
    emitBaseDirsConfigFieldDeprecationWarning();
    if (configParams.outputRoots === undefined) {
      configParams.outputRoots = deprecatedBaseDirs;
    }
  }
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
export { emitBaseDirsConfigFieldDeprecationWarning, emitFeaturesObjectFormDeprecationWarning };

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
    outputRoots: localConfig.outputRoots ?? baseConfig.outputRoots,
    global: localConfig.global ?? baseConfig.global,
    silent: localConfig.silent ?? baseConfig.silent,
    simulateCommands: localConfig.simulateCommands ?? baseConfig.simulateCommands,
    simulateSubagents: localConfig.simulateSubagents ?? baseConfig.simulateSubagents,
    simulateSkills: localConfig.simulateSkills ?? baseConfig.simulateSkills,
    gitignoreTargetsOnly: localConfig.gitignoreTargetsOnly ?? baseConfig.gitignoreTargetsOnly,
    gitignoreDestination: localConfig.gitignoreDestination ?? baseConfig.gitignoreDestination,
    dryRun: localConfig.dryRun ?? baseConfig.dryRun,
    check: localConfig.check ?? baseConfig.check,
    inputRoot: localConfig.inputRoot ?? baseConfig.inputRoot,
    sources: localConfig.sources ?? baseConfig.sources,
  };
};

/**
 * Resolve a single config value honouring precedence:
 * CLI option > config-file value > default. The first defined value wins.
 */
function pick<T>({
  cli,
  file,
  fallback,
}: {
  cli: T | undefined;
  file: T | undefined;
  fallback: T;
}): T {
  return cli ?? file ?? fallback;
}

/**
 * Map the deprecated `baseDirs` alias onto `outputRoots`. If both are supplied,
 * `outputRoots` wins; either way emit a one-shot deprecation warning so callers
 * know to migrate. Returns the effective `outputRoots`.
 */
function applyDeprecatedBaseDirs({
  outputRoots,
  deprecatedBaseDirs,
}: {
  outputRoots: string[] | undefined;
  deprecatedBaseDirs: string[] | undefined;
}): string[] | undefined {
  if (deprecatedBaseDirs === undefined) {
    return outputRoots;
  }
  emitBaseDirsConfigFieldDeprecationWarning();
  return outputRoots ?? deprecatedBaseDirs;
}

/**
 * Re-validate `targets`/`features` mutual-exclusivity after the base and local
 * config files have been merged. A base file and local file can each be valid
 * in isolation yet merge into an invalid `{ targets: object, features: array }`
 * state, so this throws with a message naming both files.
 */
function assertMergedTargetsFeaturesExclusive({
  configByFile,
  validatedConfigPath,
  localConfigPath,
}: {
  configByFile: PartialConfigParams;
  validatedConfigPath: string;
  localConfigPath: string;
}): void {
  try {
    assertTargetsFeaturesExclusive({
      targets: configByFile.targets,
      features: configByFile.features,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);
    throw new Error(
      `${detail} (detected after merging '${validatedConfigPath}' with '${localConfigPath}' — the two files combined produce the invalid combination; remove the conflicting field from one of them).`,
      { cause: error },
    );
  }
}

/**
 * Resolve the effective `global` flag. When an `inputRoot` is in play the user
 * is decoupling source from output, so a config-file `global: true` is dropped
 * (unless the caller also explicitly passes `global`); a warning is emitted in
 * that case. Returns the resolved boolean `global`.
 */
function resolveGlobal({
  logger,
  resolvedInputRoot,
  global,
  configByFile,
  validatedConfigPath,
}: {
  logger: Logger | undefined;
  resolvedInputRoot: string | undefined;
  global: boolean | undefined;
  configByFile: PartialConfigParams;
  validatedConfigPath: string;
}): boolean {
  if (resolvedInputRoot !== undefined && global === undefined && configByFile.global === true) {
    warnWithFallback(
      logger,
      `Ignoring "global: true" from ${JSON.stringify(validatedConfigPath)} because ` +
        `an inputRoot was configured; pass global=true (CLI: --global) to keep ` +
        `user-scope output. Output will be project-scope (global=false).`,
    );
  }
  const configGlobal = resolvedInputRoot !== undefined ? false : configByFile.global;
  return pick({ cli: global, file: configGlobal, fallback: getDefaults().global });
}

/**
 * Resolve `features`/`targets` while honouring the strict mutual-exclusivity
 * rule enforced by `assertTargetsFeaturesExclusive`:
 *
 * - When the user provides `targets` in object form, `features` must stay
 *   undefined (the per-target feature config lives inside the `targets`
 *   object); skip the `features` default.
 * - When the user provides `features` in object form without `targets`, leave
 *   `targets` undefined so `Config.getTargets` can derive the target list from
 *   the `features` object keys; skip the `targets` default.
 * - Otherwise fall through to the array-form defaults.
 */
function resolveFeaturesAndTargets({
  features,
  targets,
  configByFile,
}: {
  features: ConfigResolverResolveParams["features"];
  targets: ConfigResolverResolveParams["targets"];
  configByFile: PartialConfigParams;
}): {
  resolvedFeatures: ConfigParams["features"];
  resolvedTargets: ConfigParams["targets"];
} {
  const userProvidedFeatures = features ?? configByFile.features;
  const userProvidedTargets = targets ?? configByFile.targets;
  const targetsIsObject = userProvidedTargets !== undefined && !Array.isArray(userProvidedTargets);
  const featuresIsObject =
    userProvidedFeatures !== undefined && !Array.isArray(userProvidedFeatures);
  if (featuresIsObject) {
    emitFeaturesObjectFormDeprecationWarning();
  }
  const resolvedFeatures =
    userProvidedFeatures ?? (targetsIsObject ? undefined : getDefaults().features);
  const resolvedTargets =
    userProvidedTargets ?? (featuresIsObject ? undefined : getDefaults().targets);
  return { resolvedFeatures, resolvedTargets };
}

// oxlint-disable-next-line no-extraneous-class
export class ConfigResolver {
  public static async resolve(
    {
      targets,
      features,
      verbose,
      delete: isDelete,
      outputRoots,
      baseDirs: deprecatedBaseDirs,
      configPath = getDefaults().configPath,
      global,
      silent,
      simulateCommands,
      simulateSubagents,
      simulateSkills,
      gitignoreTargetsOnly,
      dryRun,
      check,
      gitignoreDestination,
      inputRoot,
    }: ConfigResolverResolveParams,
    { logger }: { logger?: Logger } = {},
  ): Promise<Config> {
    // Map the deprecated programmatic `baseDirs` alias to `outputRoots`.
    // If both are supplied, `outputRoots` wins; either way emit a one-shot
    // deprecation warning so callers know to migrate.
    outputRoots = applyDeprecatedBaseDirs({ outputRoots, deprecatedBaseDirs });
    // Capture cwd once at the entry point so the resolved config is
    // deterministic and independent of any later `process.chdir()` calls.
    const cwd = resolve(process.cwd());

    // Validate configPath to prevent path traversal attacks
    // When inputRoot is set, resolve the config path relative to it so that
    // the user's central .rulesync source dir is also the config source.
    // Validate the *raw* inputRoot first so traversal patterns like
    // `/foo/../bar` cannot slip through `resolve()`'s normalization. We do
    // not validate cwd itself because cwd is trusted process state, not
    // attacker-controlled input.
    if (inputRoot !== undefined) {
      validateOutputRoot(inputRoot);
    }
    const configOutputRoot = resolve(inputRoot ?? cwd);
    const validatedConfigPath = resolvePath(configPath, configOutputRoot);

    // Load base config (rulesync.jsonc)
    const baseConfig = await loadConfigFromFile(validatedConfigPath);

    // Load local config (rulesync.local.jsonc) from the same directory as the base config
    const configDir = dirname(validatedConfigPath);
    const localConfigPath = join(configDir, RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH);
    const localConfig = await loadConfigFromFile(localConfigPath);

    // Merge configs: local config takes precedence over base config
    // Priority: CLI options > rulesync.local.jsonc > rulesync.jsonc > defaults
    const configByFile = mergeConfigs(baseConfig, localConfig);

    // Validate `inputRoot` coming from a config file too — symmetric with the
    // CLI/programmatic flow, which validates the resolved `configOutputRoot`
    // above. We only validate when CLI/programmatic `inputRoot` is not set
    // (otherwise `configOutputRoot` already covered that case).
    if (inputRoot === undefined && configByFile.inputRoot !== undefined) {
      validateOutputRoot(configByFile.inputRoot);
    }

    // Per-file `assertTargetsFeaturesExclusive` in `loadConfigFromFile` only
    // sees one file at a time, so a base file with array-form `features` plus
    // a local file with object-form `targets` (each valid in isolation) can
    // merge into an invalid `{ targets: object, features: array }` state.
    // Re-check after the merge and throw with a message that names both files
    // so the user knows where to look.
    assertMergedTargetsFeaturesExclusive({ configByFile, validatedConfigPath, localConfigPath });

    // When `inputRoot` is set (from CLI, programmatic args, or a config file)
    // the user is decoupling source from output, so "global: true" from the
    // config file must not apply unless the caller also explicitly passes
    // --global. Warn when we drop it so the user is not silently surprised
    // by an output-scope change.
    //
    // Note: this also covers the config-file-only `inputRoot` case — even
    // though the resolver does not re-load the config file from
    // `configByFile.inputRoot`, the symmetric warning still fires so a user
    // moving from CLI flag to config-file form sees consistent behavior.
    const resolvedInputRoot = inputRoot ?? configByFile.inputRoot;
    const resolvedGlobal = resolveGlobal({
      logger,
      resolvedInputRoot,
      global,
      configByFile,
      validatedConfigPath,
    });

    const { resolvedFeatures, resolvedTargets } = resolveFeaturesAndTargets({
      features,
      targets,
      configByFile,
    });

    const configParams = {
      targets: resolvedTargets,
      features: resolvedFeatures,
      verbose: pick({ cli: verbose, file: configByFile.verbose, fallback: getDefaults().verbose }),
      delete: pick({ cli: isDelete, file: configByFile.delete, fallback: getDefaults().delete }),
      outputRoots: getOutputRootsInLightOfGlobal({
        outputRoots: pick({
          cli: outputRoots,
          file: configByFile.outputRoots,
          fallback: getDefaults().outputRoots,
        }),
        global: resolvedGlobal,
      }),
      global: resolvedGlobal,
      silent: pick({ cli: silent, file: configByFile.silent, fallback: getDefaults().silent }),
      simulateCommands: pick({
        cli: simulateCommands,
        file: configByFile.simulateCommands,
        fallback: getDefaults().simulateCommands,
      }),
      simulateSubagents: pick({
        cli: simulateSubagents,
        file: configByFile.simulateSubagents,
        fallback: getDefaults().simulateSubagents,
      }),
      simulateSkills: pick({
        cli: simulateSkills,
        file: configByFile.simulateSkills,
        fallback: getDefaults().simulateSkills,
      }),
      gitignoreTargetsOnly: pick({
        cli: gitignoreTargetsOnly,
        file: configByFile.gitignoreTargetsOnly,
        fallback: getDefaults().gitignoreTargetsOnly,
      }),
      gitignoreDestination: pick({
        cli: gitignoreDestination,
        file: configByFile.gitignoreDestination,
        fallback: getDefaults().gitignoreDestination,
      }),
      dryRun: pick({ cli: dryRun, file: configByFile.dryRun, fallback: getDefaults().dryRun }),
      check: pick({ cli: check, file: configByFile.check, fallback: getDefaults().check }),
      // Pass the fully-resolved absolute inputRoot so `Config.getInputRoot()`
      // is pure and never re-reads `process.cwd()` after construction. When
      // neither CLI nor config file supplied an inputRoot, fall back to the
      // captured `cwd` so the value is still deterministic.
      inputRoot: resolvedInputRoot !== undefined ? resolve(resolvedInputRoot) : cwd,
      sources: configByFile.sources ?? getDefaults().sources,
      configFileTargets: extractConfigFileTargets(configByFile.targets),
    };
    const config = new Config(configParams);
    // The legacy `antigravity` target is never produced by wildcard expansion
    // (it lives in LEGACY_TARGETS), so its presence here means the user
    // explicitly selected it. Warn that it is now an alias for `antigravity-ide`.
    if (config.getTargets().includes("antigravity")) {
      emitAntigravityAliasDeprecationWarning();
    }
    return config;
  }
}

function getOutputRootsInLightOfGlobal({
  outputRoots,
  global,
}: {
  outputRoots: string[];
  global: boolean;
}): string[] {
  if (global) {
    // When global is true, the base directory is always the home directory
    return [getHomeDirectory()];
  }

  // Validate the *raw* user input first so traversal patterns like
  // `/foo/../bar` cannot slip through `resolve()`'s normalization. Then
  // resolve to absolute for downstream consumers.
  outputRoots.forEach((outputRoot) => {
    validateOutputRoot(outputRoot);
  });

  return outputRoots.map((outputRoot) => resolve(outputRoot));
}

function extractConfigFileTargets(
  targets: RulesyncConfigTargets | undefined,
): ToolTarget[] | undefined {
  if (targets === undefined) return undefined;
  const validTargets = new Set<string>(ALL_TOOL_TARGETS);
  if (isRulesyncConfigTargetsObject(targets)) {
    return Object.keys(targets).filter((key): key is ToolTarget => validTargets.has(key));
  }
  // The wildcard form `["*"]` lists every (non-legacy) target in the config
  // file. Expand it via the shared helper (also used by `Config.getTargets()`)
  // so the returned list is the full config-file target set rather than an
  // empty array. An empty result would make `getConfigFileTargets()` fall back
  // to the CLI-filtered `getTargets()`, breaking root-file ownership
  // computation for the very common `targets: ["*"]` form (see #1981 / #1894).
  if (targets.includes("*")) {
    return expandWildcardTargets();
  }
  return targets.filter((key): key is ToolTarget => key !== "*" && validTargets.has(key));
}
