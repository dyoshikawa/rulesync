import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { checkRulesyncDirExists, generate, type GenerateResult } from "../../lib/generate.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import type { Logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type GenerateOptions = ConfigResolverResolveParams;

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
  const config = await ConfigResolver.resolve(options, { logger });

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
