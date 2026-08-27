import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import type { Config } from "../../config/config.js";
import { generate, inspectInputRoots, type GenerateResult } from "../../lib/generate.js";
import {
  buildConfigFilePaths,
  buildWatchTargets,
  formatTriggerPaths,
  WatchScheduler,
  watchTargets,
} from "../../lib/watch.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type GenerateOptions = ConfigResolverResolveParams & {
  /** Keep running and regenerate whenever a rulesync source file changes. */
  watch?: boolean;
};

/**
 * Raised when at least one `.rulesync/` source file exists but could not be
 * read. It is its own type so `--watch` can tell it apart from a configuration
 * error: a malformed source is an edit the user is about to correct, and the
 * watcher should stay up for that correction.
 */
export class SourceLoadFailedError extends CLIError {
  constructor(features: readonly string[]) {
    super(
      `Some .rulesync source files could not be loaded (see the errors above), so nothing was generated for ${
        features.length > 0 ? features.join(", ") : "them"
      }.`,
      ErrorCodes.GENERATION_FAILED,
      1,
      { sourceLoadFailedFeatures: [...features] },
    );
    this.name = "SourceLoadFailedError";
  }
}

/**
 * Log feature generation result with appropriate prefix based on dry run mode.
 */
function logFeatureResult(
  logger: Logger,
  params: {
    count: number;
    paths: string[];
    featureName: string;
    isPreview: boolean;
    modePrefix: string;
  },
): void {
  const { count, paths, featureName, isPreview, modePrefix } = params;
  if (count > 0) {
    if (isPreview) {
      logger.info(`${modePrefix} Would write ${count} ${featureName}`);
    } else {
      logger.success(`Written ${count} ${featureName}`);
    }
    for (const p of paths) {
      logger.info(`    ${p}`);
    }
  }
}

const FEATURE_DEBUG_MESSAGES: Record<string, string> = {
  ignore: "Generating ignore files...",
  mcp: "Generating MCP files...",
  commands: "Generating command files...",
  subagents: "Generating subagent files...",
  skills: "Generating skill files...",
  hooks: "Generating hooks...",
  checks: "Generating check files...",
  rules: "Generating rule files...",
};

// Order in which per-feature debug messages are emitted; matches the original
// sequential `if (features.includes(...))` ladder.
const FEATURE_DEBUG_ORDER = [
  "ignore",
  "mcp",
  "commands",
  "subagents",
  "skills",
  "hooks",
  "checks",
  "rules",
] as const;

function logFeatureDebugMessages(logger: Logger, features: readonly string[]): void {
  for (const feature of FEATURE_DEBUG_ORDER) {
    if (features.includes(feature)) {
      logger.debug(FEATURE_DEBUG_MESSAGES[feature] ?? "");
    }
  }
}

/**
 * Build the human-readable per-feature summary fragments (e.g. "3 rules") for
 * features that produced at least one file. Order matches the original
 * sequential `if (count > 0) parts.push(...)` ladder.
 */
function buildSummaryParts(result: GenerateResult): string[] {
  const summarySpecs: { count: number; label: string }[] = [
    { count: result.rulesCount, label: "rules" },
    { count: result.ignoreCount, label: "ignore files" },
    { count: result.mcpCount, label: "MCP files" },
    { count: result.commandsCount, label: "commands" },
    { count: result.subagentsCount, label: "subagents" },
    { count: result.skillsCount, label: "skills" },
    { count: result.hooksCount, label: "hooks" },
    { count: result.permissionsCount, label: "permissions" },
    { count: result.checksCount, label: "checks" },
    { count: result.activationCount, label: "Hermes activation files" },
  ];

  const parts: string[] = [];
  for (const { count, label } of summarySpecs) {
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts;
}

export async function generateCommand(logger: Logger, options: GenerateOptions): Promise<void> {
  if (options.watch) {
    await generateWatchCommand(logger, options);
    return;
  }
  await generateOnce(logger, options);
}

/**
 * Runs one generation. `resolvedConfig` lets a caller that already resolved
 * the configuration (watch mode's startup validation) reuse it instead of
 * paying for a second resolution — and, more importantly, instead of emitting
 * the resolver's warnings twice.
 */
async function generateOnce(
  logger: Logger,
  options: GenerateOptions,
  { resolvedConfig }: { resolvedConfig?: Config } = {},
): Promise<void> {
  const config = resolvedConfig ?? (await ConfigResolver.resolve(options, { logger }));

  const check = config.getCheck();

  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[DRY RUN]" : "";

  logger.debug("Generating files...");

  const inputRoots = config.getInputRoots();

  const inputRootInspection = await inspectInputRoots(inputRoots);

  if (inputRootInspection.message !== undefined) {
    throw new CLIError(inputRootInspection.message, ErrorCodes.RULESYNC_DIR_NOT_FOUND);
  }

  logger.debug(`Output roots: ${config.getOutputRoots().join(", ")}`);

  const features = config.getFeatures();

  logFeatureDebugMessages(logger, features);

  const result = await generate({ config, logger });

  const totalGenerated = calculateTotalCount(result);

  // Log feature results and capture data for JSON mode
  const featureResults = {
    ignore: { count: result.ignoreCount, paths: result.ignorePaths },
    mcp: { count: result.mcpCount, paths: result.mcpPaths },
    commands: { count: result.commandsCount, paths: result.commandsPaths },
    subagents: { count: result.subagentsCount, paths: result.subagentsPaths },
    skills: { count: result.skillsCount, paths: result.skillsPaths },
    hooks: { count: result.hooksCount, paths: result.hooksPaths },
    permissions: { count: result.permissionsCount, paths: result.permissionsPaths },
    checks: { count: result.checksCount, paths: result.checksPaths },
    rules: { count: result.rulesCount, paths: result.rulesPaths },
    activation: { count: result.activationCount, paths: result.activationPaths },
  };

  // Map feature keys to human-readable labels with pluralization
  const featureLabels: Record<string, (count: number) => string> = {
    rules: (count) => `${count === 1 ? "rule" : "rules"}`,
    ignore: (count) => `${count === 1 ? "ignore file" : "ignore files"}`,
    mcp: (count) => `${count === 1 ? "MCP file" : "MCP files"}`,
    commands: (count) => `${count === 1 ? "command" : "commands"}`,
    subagents: (count) => `${count === 1 ? "subagent" : "subagents"}`,
    skills: (count) => `${count === 1 ? "skill" : "skills"}`,
    hooks: (count) => `${count === 1 ? "hooks file" : "hooks files"}`,
    permissions: (count) => `${count === 1 ? "permissions file" : "permissions files"}`,
    checks: (count) => `${count === 1 ? "check" : "checks"}`,
    activation: (count) => `${count === 1 ? "Hermes activation file" : "Hermes activation files"}`,
  };

  for (const [feature, data] of Object.entries(featureResults)) {
    logFeatureResult(logger, {
      count: data.count,
      paths: data.paths,
      featureName: featureLabels[feature]?.(data.count) ?? feature,
      isPreview,
      modePrefix,
    });
  }

  // Capture JSON data if in JSON mode
  if (logger.jsonMode) {
    logger.captureData("features", featureResults);
    logger.captureData("totalFiles", totalGenerated);
    logger.captureData("hasDiff", result.hasDiff);
    logger.captureData("skills", result.skills ?? []);
  }

  // A source file that failed to load was already reported as an error, but
  // every counter above reads zero for it — the same as "nothing to do". Fail
  // here so a caller that only sees the exit code is not told the generated
  // configs are current when they were never written.
  if (result.sourceLoadFailed) {
    throw new SourceLoadFailedError(result.sourceLoadFailedFeatures);
  }

  // Check mode must fail even when the change is delete-only and no files are written.
  if (check) {
    if (result.hasDiff) {
      throw new CLIError(
        "Files are not up to date. Run 'rulesync generate' to update.",
        ErrorCodes.GENERATION_FAILED,
      );
    }

    logger.success("✓ All files are up to date.");
    return;
  }

  if (totalGenerated === 0) {
    const enabledFeatures = features.join(", ");
    logger.info(`✓ All files are up to date (${enabledFeatures})`);
    return;
  }

  const parts = buildSummaryParts(result);

  if (isPreview) {
    logger.info(`${modePrefix} Would write ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  } else {
    logger.success(`🎉 All done! Written ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }
}

/**
 * Rejects flag combinations that contradict a long-running watch: `--check`
 * and `--dry-run` are one-shot verification modes (the former is meant to exit
 * non-zero), and `--json` buffers a single result document until the command
 * returns, which never happens while watching.
 */
export function assertWatchModeCompatible({
  isCheck,
  isDryRun,
  isJsonMode,
}: {
  isCheck: boolean;
  isDryRun: boolean;
  isJsonMode: boolean;
}): void {
  const conflicts = [
    isCheck ? "--check" : undefined,
    isDryRun ? "--dry-run" : undefined,
    isJsonMode ? "--json" : undefined,
  ].filter((flag): flag is string => flag !== undefined);

  if (conflicts.length > 0) {
    throw new CLIError(
      `--watch cannot be combined with ${conflicts.join(", ")}.`,
      ErrorCodes.VALIDATION_FAILED,
    );
  }
}

async function generateWatchCommand(logger: Logger, options: GenerateOptions): Promise<void> {
  // Resolve once up front so the incompatible-mode check also covers values
  // coming from the config file, not just CLI flags.
  const config = await ConfigResolver.resolve(options, { logger });
  assertWatchModeCompatible({
    isCheck: config.getCheck(),
    isDryRun: config.getDryRun(),
    isJsonMode: logger.jsonMode,
  });

  const inputRoots = config.getInputRoots();
  // Take the path the resolver actually loaded rather than re-deriving it:
  // the two differ when input roots come from the configuration file itself.
  const configFilePath = config.getConfigFilePath();
  const configFilePaths = buildConfigFilePaths({ configFilePath });

  // Run once before watching so a missing primary source tree (or any other
  // configuration error) fails fast. Missing optional overlays remain watch
  // targets and attach if they are created later.
  try {
    await generateOnce(logger, options, { resolvedConfig: config });
  } catch (error) {
    // A source file that cannot be read is a bad edit, not a broken setup, and
    // saving the fix is exactly what the watcher is here for. Report it and
    // keep going, the same way the scheduler's `onError` does for every later
    // run. Anything else still fails fast.
    if (!(error instanceof SourceLoadFailedError)) {
      throw error;
    }
    logger.error(`Generation failed: ${formatError(error)}`);
    logger.info("Still watching for changes...");
  }

  const targets = buildWatchTargets({ inputRoots, configFilePath });

  const scheduler = new WatchScheduler({
    run: async ({ triggers }) => {
      logger.info(`\nChange detected: ${formatTriggerPaths({ triggers, inputRoots })}`);

      if (triggers.some((trigger) => configFilePaths.has(trigger))) {
        logger.warn(
          "Configuration file changed. The set of watched paths is fixed at startup — restart 'rulesync generate --watch' if you changed 'inputRoot'/'inputRoots' or the configuration file location.",
        );
      }

      await generateOnce(logger, options);
    },
    onError: ({ error }) => {
      logger.error(`Generation failed: ${formatError(error)}`);
      logger.info("Still watching for changes...");
    },
  });

  const handle = watchTargets({
    targets,
    onChange: ({ path }) => {
      scheduler.notify({ path });
    },
    onError: ({ error, directory }) => {
      logger.error(`Watch error on ${directory}: ${formatError(error)}`);
    },
  });

  logger.info(
    `\nWatching for changes in:\n${targets.map((target) => `    ${target.directory}`).join("\n")}`,
  );
  logger.info("Press Ctrl+C to stop.");

  await new Promise<void>((resolveShutdown) => {
    const shutdown = (): void => {
      process.off("SIGINT", shutdown);
      process.off("SIGTERM", shutdown);
      handle.close();
      void scheduler
        .close()
        .catch((error: unknown) => {
          logger.error(`Failed to stop the watcher cleanly: ${formatError(error)}`);
        })
        .finally(() => {
          logger.info("\nStopped watching.");
          resolveShutdown();
        });
    };
    process.once("SIGINT", shutdown);
    process.once("SIGTERM", shutdown);
  });
}
