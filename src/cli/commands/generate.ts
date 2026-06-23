import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { checkRulesyncDirExists, generate, type GenerateResult } from "../../lib/generate.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type GenerateOptions = ConfigResolverResolveParams & {
  // Commander maps `--base-dir <paths>` to `baseDir` (camelCase, singular)
  // while the resolver canonical field is `outputRoots` (plural). The CLI
  // flag is a deprecated alias retained for backward compatibility — accept
  // the CLI shape here and normalize at the command boundary, emitting a
  // one-shot deprecation warning when it is used.
  baseDir?: string[];
};

/**
 * Compares two output-root lists as sets — order-insensitive and
 * duplicate-insensitive. Used to decide whether `--base-dir` and
 * `--output-roots` actually differ. Identical sets like `["a", "b"]` vs
 * `["b", "a"]` should NOT trigger the override warning.
 */
function sameDirSets(a: readonly string[], b: readonly string[]): boolean {
  const aSet = new Set(a);
  const bSet = new Set(b);
  if (aSet.size !== bSet.size) return false;
  for (const v of aSet) {
    if (!bSet.has(v)) return false;
  }
  return true;
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

/**
 * Resolve the effective output roots from the canonical `--output-roots` and
 * the deprecated `--base-dir` alias, emitting the relevant deprecation /
 * override warnings as a side effect. Returns the resolved output-root list.
 */
function resolveOutputRoots({
  logger,
  baseDir,
  outputRoots,
}: {
  logger: Logger;
  baseDir: string[] | undefined;
  outputRoots: string[] | undefined;
}): string[] | undefined {
  // The deprecated `--base-dir` CLI flag is accepted as an alias of
  // `--output-roots`. Emit a deprecation warning whenever it is used so the
  // user sees a clear migration prompt at the call site. When both are
  // supplied with non-empty, differing values, prefer `--output-roots` but
  // also surface the override to the user. Identical (set-equal, order-
  // insensitive) or empty inputs are silently merged.
  if (baseDir !== undefined) {
    logger.warn(
      "--base-dir is deprecated; use --output-roots instead. " +
        "It will be removed in a future major release.",
    );
  }
  // Treat `outputRoots: []` as "not provided" so a programmatic caller
  // passing an empty array does not silently win over a non-empty `baseDir`.
  // Without this, `outputRoots ?? baseDir` would resolve to `[]` and override
  // the deprecated alias even when the alias carried real values.
  const outputRootsResolved =
    outputRoots !== undefined && outputRoots.length > 0 ? outputRoots : baseDir;
  if (
    baseDir !== undefined &&
    outputRoots !== undefined &&
    baseDir.length > 0 &&
    outputRoots.length > 0 &&
    !sameDirSets(outputRoots, baseDir)
  ) {
    logger.warn(
      `Both '--output-roots' and '--base-dir' were provided with differing ` +
        `values; using '--output-roots' (${JSON.stringify(outputRoots)}) and ` +
        `ignoring '--base-dir' (${JSON.stringify(baseDir)}).`,
    );
  }

  return outputRootsResolved;
}

const FEATURE_DEBUG_MESSAGES: Record<string, string> = {
  ignore: "Generating ignore files...",
  mcp: "Generating MCP files...",
  commands: "Generating command files...",
  subagents: "Generating subagent files...",
  skills: "Generating skill files...",
  hooks: "Generating hooks...",
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
  ];

  const parts: string[] = [];
  for (const { count, label } of summarySpecs) {
    if (count > 0) parts.push(`${count} ${label}`);
  }
  return parts;
}

export async function generateCommand(logger: Logger, options: GenerateOptions): Promise<void> {
  const { baseDir, outputRoots, ...rest } = options;

  const outputRootsResolved = resolveOutputRoots({ logger, baseDir, outputRoots });

  const config = await ConfigResolver.resolve(
    { ...rest, outputRoots: outputRootsResolved },
    { logger },
  );

  const check = config.getCheck();

  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[DRY RUN]" : "";

  logger.debug("Generating files...");

  if (!(await checkRulesyncDirExists({ inputRoot: config.getInputRoot() }))) {
    throw new CLIError(
      ".rulesync directory not found. Run 'rulesync init' first.",
      ErrorCodes.RULESYNC_DIR_NOT_FOUND,
    );
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
    rules: { count: result.rulesCount, paths: result.rulesPaths },
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
