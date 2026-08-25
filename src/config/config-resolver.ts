import { dirname, join, resolve } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import {
  RULESYNC_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_LOCAL_CONFIG_RELATIVE_FILE_PATH,
  RULESYNC_RELATIVE_DIR_PATH,
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
import { fallbackLogger, type Logger, warnWithFallback } from "../utils/logger.js";
import {
  assertInputRootFieldsExclusive,
  assertInputRootsNonEmpty,
  assertTargetsFeaturesExclusive,
  Config,
  ConfigFile,
  ConfigFileSchema,
  ConfigParams,
  expandWildcardTargets,
  PartialConfigParams,
  RequiredConfigParams,
} from "./config.js";
import type { OutputRoots } from "./config.js";

/**
 * CLI-resolvable params exclude `sources` and `flattenedCommandNaming` — they
 * are config-file-only.
 */
export type ConfigResolverResolveParams = Partial<
  Omit<ConfigParams, "sources" | "flattenedCommandNaming"> & {
    configPath: string;
  }
>;

// `inputRoot`/`inputRoots` are intentionally optional — omitting them means
// "use CWD". All other fields are concrete defaults so callers (and the
// resolver) can rely on `getDefaults().<field>` being populated.
type ConfigDefaults = Omit<RequiredConfigParams, "inputRoot" | "inputRoots"> & {
  inputRoot?: string;
  inputRoots?: string[];
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
  flattenedCommandNaming: "basename",
  gitignoreTargetsOnly: true,
  gitignoreDestination: "gitignore",
  dryRun: false,
  check: false,
  inputRoot: undefined,
  inputRoots: undefined,
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
  // Reject a single file declaring both `inputRoot` and `inputRoots`. The
  // cross-file case is handled at merge time (see `resolveEffectiveInputRoots`)
  // — base and local can each be valid in isolation and the resolver prefers
  // `inputRoots` when both survive.
  try {
    assertInputRootFieldsExclusive({
      inputRoot: configParams.inputRoot,
      inputRoots: configParams.inputRoots,
    });
  } catch (error) {
    const detail = error instanceof Error ? error.message : String(error);

    throw new Error(`${detail} (in ${JSON.stringify(filePath)})`, { cause: error });
  }

  return configParams;
};

export type InputRootConfig = Pick<PartialConfigParams, "inputRoot" | "inputRoots">;

export function mergeInputRootConfigs({
  baseConfig,
  localConfig,
}: {
  baseConfig: InputRootConfig;
  localConfig: InputRootConfig;
}): InputRootConfig {
  return {
    inputRoot: localConfig.inputRoot ?? baseConfig.inputRoot,
    inputRoots: localConfig.inputRoots ?? baseConfig.inputRoots,
  };
}

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
    flattenedCommandNaming: localConfig.flattenedCommandNaming ?? baseConfig.flattenedCommandNaming,
    gitignoreTargetsOnly: localConfig.gitignoreTargetsOnly ?? baseConfig.gitignoreTargetsOnly,
    gitignoreDestination: localConfig.gitignoreDestination ?? baseConfig.gitignoreDestination,
    dryRun: localConfig.dryRun ?? baseConfig.dryRun,
    check: localConfig.check ?? baseConfig.check,
    ...mergeInputRootConfigs({ baseConfig, localConfig }),
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
 * Resolve the effective `global` flag. When an input root (singular
 * `inputRoot` or plural `inputRoots`) is in play the user is decoupling
 * source from output, so a config-file `global: true` is dropped (unless
 * the caller also explicitly passes `global`); a warning is emitted in
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
        `an input root was configured; pass global=true (CLI: --global) to keep ` +
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
  const resolvedFeatures =
    userProvidedFeatures ?? (targetsIsObject ? undefined : getDefaults().features);
  const resolvedTargets = userProvidedTargets ?? getDefaults().targets;
  return { resolvedFeatures, resolvedTargets };
}

/**
 * Resolve the effective, non-empty, absolute-path list of source-tree roots
 * by applying CLI > file > default precedence and preferring `inputRoots`
 * over `inputRoot` when both survive the base+local merge. Duplicates (after
 * normalization to absolute paths) are removed silently so overlapping
 * base/local declarations do not double-count the same tree.
 *
 * Semantics (post-refactor):
 * - `inputRoots` entries are the source trees themselves (each holds
 *   `rules/`, `skills/`, `mcp.jsonc`, etc.); they are passed through
 *   unchanged.
 * - `inputRoot` (legacy singular) is a shorthand for "parent of the
 *   `.rulesync/` source tree" and is expanded to `join(inputRoot,
 *   ".rulesync")` before it hits any consumer.
 * - The "nothing configured" default expands to `[join(cwd, ".rulesync")]`
 *   so existing projects keep working unchanged.
 *
 * When both the merged file config has `inputRoots` and the CLI supplied
 * `inputRoot` (or vice versa), CLI wins outright — matching how every
 * other field is resolved. When only the file config supplies both, the
 * plural wins over the singular and the drop is logged at debug level.
 */
export function resolveEffectiveInputRoots({
  cliInputRoot,
  cliInputRoots,
  configByFile,
  cwd,
  logger,
}: {
  cliInputRoot: string | undefined;
  cliInputRoots: string[] | undefined;
  configByFile: PartialConfigParams;
  cwd: string;
  logger: Logger | undefined;
}): {
  inputRoots: [string, ...string[]];
  candidates: string[];
  field: "inputRoot" | "inputRoots" | undefined;
} {
  let source: readonly string[] | undefined;
  let field: "inputRoot" | "inputRoots" | undefined;

  if (cliInputRoots !== undefined && cliInputRoots.length > 0) {
    source = cliInputRoots;
    field = "inputRoots";
  } else if (cliInputRoot !== undefined) {
    source = [join(cliInputRoot, RULESYNC_RELATIVE_DIR_PATH)];
    field = "inputRoot";
  } else if (configByFile.inputRoots !== undefined && configByFile.inputRoots.length > 0) {
    source = configByFile.inputRoots;
    field = "inputRoots";

    if (configByFile.inputRoot !== undefined) {
      logger?.debug(
        `Both 'inputRoot' and 'inputRoots' were set after merging base and local configs; 'inputRoots' wins and 'inputRoot' was dropped.`,
      );
    }
  } else if (configByFile.inputRoot !== undefined) {
    source = [join(configByFile.inputRoot, RULESYNC_RELATIVE_DIR_PATH)];
    field = "inputRoot";
  } else {
    source = [join(cwd, RULESYNC_RELATIVE_DIR_PATH)];
  }

  // Resolve against the passed-in `cwd` rather than the ambient
  // `process.cwd()`, so a relative entry lands under the directory the caller
  // considers current (the default branch above already anchors to `cwd`).
  const candidates = source.map((entry) => resolve(cwd, entry));
  const seen = new Set<string>();
  const resolved: string[] = [];

  for (const absolute of candidates) {
    if (seen.has(absolute)) continue;

    seen.add(absolute);
    resolved.push(absolute);
  }

  return {
    inputRoots: [resolved[0]!, ...resolved.slice(1)],
    candidates,
    field,
  };
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
      inputRoots,
    }: ConfigResolverResolveParams,
    { logger }: { logger?: Logger } = {},
  ): Promise<Config> {
    // Capture cwd once at the entry point so the resolved config is
    // deterministic and independent of any later `process.chdir()` calls.
    const cwd = resolve(process.cwd());

    // Enforce the CLI/programmatic-level mutex — combining the singular and
    // plural flags in one invocation is always a user error. The per-file
    // mutex is enforced separately in `loadConfigFromFile`; the cross-file
    // case where base has one and local has the other resolves cleanly with
    // `inputRoots` winning (see `resolveEffectiveInputRoots`).
    assertInputRootFieldsExclusive({ inputRoot, inputRoots });
    assertInputRootsNonEmpty({ inputRoots });

    // Validate configPath to prevent path traversal attacks.
    //
    // Anchor precedence for the config file:
    // - CLI `inputRoot` (legacy singular alias): its value is a parent-of
    //   the source tree, so it remains the config-file anchor for backward
    //   compatibility.
    // - CLI `inputRoots` (plural) does not affect config discovery. Its
    //   entries are source trees, not config locations.
    // - Otherwise, including plural input roots, resolve from cwd.
    //
    // Validate the *raw* CLI-supplied input root(s) first so traversal
    // patterns like `/foo/../bar` cannot slip through `resolve()`'s
    // normalization. We do not validate cwd itself because cwd is trusted
    // process state, not attacker-controlled input.
    if (inputRoot !== undefined) {
      validateOutputRoot(inputRoot);
    }

    if (inputRoots !== undefined) {
      for (const entry of inputRoots) {
        validateOutputRoot(entry);
      }
    }

    const cliConfigAnchor = inputRoot;
    const hasCliInputRootOverride = inputRoot !== undefined || inputRoots !== undefined;
    const configOutputRoot = resolve(cliConfigAnchor ?? cwd);
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

    // Validate `inputRoot`/`inputRoots` coming from a config file too —
    // symmetric with the CLI/programmatic flow, which validated the raw
    // values above. We only validate the file values when the CLI/programmatic
    // caller did not supply their own (otherwise the CLI values already
    // covered that case above).
    if (!hasCliInputRootOverride) {
      if (configByFile.inputRoot !== undefined) {
        validateOutputRoot(configByFile.inputRoot);
      }

      if (configByFile.inputRoots !== undefined) {
        for (const entry of configByFile.inputRoots) {
          validateOutputRoot(entry);
        }
      }
    }

    // Per-file `assertTargetsFeaturesExclusive` in `loadConfigFromFile` only
    // sees one file at a time, so a base file with array-form `features` plus
    // a local file with object-form `targets` (each valid in isolation) can
    // merge into an invalid `{ targets: object, features: array }` state.
    // Re-check after the merge and throw with a message that names both files
    // so the user knows where to look.
    assertMergedTargetsFeaturesExclusive({ configByFile, validatedConfigPath, localConfigPath });

    // Wire the resolved `verbose`/`silent` into the logger as soon as they are
    // known, so config-file settings are honored by every message emitted from
    // here on (including the warnings later in this resolution). CLI flags
    // still win via `pick`. Only re-configure when the caller threaded a
    // logger through — those call sites pass their CLI flags in the params, so
    // precedence stays intact. The shared `fallbackLogger` is kept in sync for
    // paths that have no logger threaded through. Note: `fallbackLogger` is
    // process-global state — do not call `resolve` with a logger from a
    // long-lived process (e.g. the MCP server) where one repository's config
    // would leak into unrelated later operations.
    const resolvedVerbose = pick({
      cli: verbose,
      file: configByFile.verbose,
      fallback: getDefaults().verbose,
    });
    const resolvedSilent = pick({
      cli: silent,
      file: configByFile.silent,
      fallback: getDefaults().silent,
    });
    if (logger !== undefined) {
      logger.configure({ verbose: resolvedVerbose, silent: resolvedSilent });
      fallbackLogger.configure({ verbose: resolvedVerbose, silent: resolvedSilent });
    }

    // Compute the effective input roots via CLI > file precedence, preferring
    // `inputRoots` over `inputRoot` when both survive the merge (this supports
    // the intended overlay flow: team `inputRoot` in `rulesync.jsonc`,
    // developer `inputRoots` in `rulesync.local.jsonc`).
    const resolvedInputRootConfig = resolveEffectiveInputRoots({
      cliInputRoot: inputRoot,
      cliInputRoots: inputRoots,
      configByFile,
      cwd,
      logger,
    });
    const resolvedInputRoots = resolvedInputRootConfig.inputRoots;
    // When any explicit input root(s) is in play (from CLI, programmatic args,
    // or a config file) the user is decoupling source from output, so
    // "global: true" from the config file must not apply unless the caller
    // also explicitly passes --global. Warn when we drop it so the user is
    // not silently surprised by an output-scope change.
    const explicitInputRoot =
      inputRoot !== undefined ||
      inputRoots !== undefined ||
      configByFile.inputRoot !== undefined ||
      configByFile.inputRoots !== undefined;
    const resolvedGlobal = resolveGlobal({
      logger,
      resolvedInputRoot: explicitInputRoot ? resolvedInputRoots[0] : undefined,
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
      verbose: resolvedVerbose,
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
      silent: resolvedSilent,
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
      // Pass the fully-resolved absolute list so `Config.getInputRoots()` is
      // pure and never re-reads `process.cwd()` after construction. When
      // neither CLI nor config file supplied a root, the list is `[cwd]`.
      inputRoots: resolvedInputRoots,
      // The path actually loaded above, so callers that need to observe the
      // configuration file (e.g. `generate --watch`) never have to re-derive
      // it and risk diverging from this resolution.
      configFilePath: validatedConfigPath,
      sources: configByFile.sources ?? getDefaults().sources,
      flattenedCommandNaming:
        configByFile.flattenedCommandNaming ?? getDefaults().flattenedCommandNaming,
      configFileTargets: extractConfigFileTargets(configByFile.targets),
    };
    const config = new Config(configParams);
    return config;
  }
}

function getOutputRootsInLightOfGlobal({
  outputRoots,
  global,
}: {
  outputRoots: OutputRoots;
  global: boolean;
}): OutputRoots {
  if (global) {
    // When global is true, the base directory is always the home directory
    return [getHomeDirectory()];
  }

  // Validate the *raw* user input first so traversal patterns like
  // `/foo/../bar` cannot slip through `resolve()`'s normalization. Then
  // resolve to absolute for downstream consumers.
  if (Array.isArray(outputRoots)) {
    outputRoots.forEach((outputRoot) => {
      validateOutputRoot(outputRoot);
    });

    return outputRoots.map((outputRoot) => resolve(outputRoot));
  }

  const resolvedOutputRoots: OutputRoots = {};
  for (const [target, targetOutputRoots] of Object.entries(outputRoots)) {
    const roots = Array.isArray(targetOutputRoots) ? targetOutputRoots : [targetOutputRoots];
    roots.forEach((outputRoot) => {
      validateOutputRoot(outputRoot);
    });
    resolvedOutputRoots[target as ToolTarget] = Array.isArray(targetOutputRoots)
      ? roots.map((outputRoot) => resolve(outputRoot))
      : resolve(targetOutputRoots);
  }

  return resolvedOutputRoots;
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
    return [
      ...new Set([
        ...expandWildcardTargets(),
        ...targets.filter((key): key is ToolTarget => key !== "*" && validTargets.has(key)),
      ]),
    ];
  }
  return targets.filter((key): key is ToolTarget => key !== "*" && validTargets.has(key));
}
