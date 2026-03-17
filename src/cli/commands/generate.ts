import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { checkRulesyncDirExists, generate } from "../../lib/generate.js";
import { CLIError, ErrorCodes } from "../../types/json-output.js";
import { Logger } from "../../utils/logger.js";
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

export async function generateCommand(logger: Logger, options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  const check = config.getCheck();

  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[DRY RUN]" : "";

  logger.debug("Generating files...");

  if (!(await checkRulesyncDirExists({ baseDir: process.cwd() }))) {
    throw new CLIError(
      ".rulesync directory not found. Run 'rulesync init' first.",
      ErrorCodes.RULESYNC_DIR_NOT_FOUND,
    );
  }

  logger.debug(`Base directories: ${config.getBaseDirs().join(", ")}`);

  const features = config.getFeatures();

  if (features.includes("ignore")) {
    logger.debug("Generating ignore files...");
  }
  if (features.includes("mcp")) {
    logger.debug("Generating MCP files...");
  }
  if (features.includes("commands")) {
    logger.debug("Generating command files...");
  }
  if (features.includes("subagents")) {
    logger.debug("Generating subagent files...");
  }
  if (features.includes("skills")) {
    logger.debug("Generating skill files...");
  }
  if (features.includes("hooks")) {
    logger.debug("Generating hooks...");
  }
  if (features.includes("permissions")) {
    logger.debug("Generating permissions...");
  }
  if (features.includes("rules")) {
    logger.debug("Generating rule files...");
  }

  const result = await generate({ config });

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
    permissions: (count) => `${count === 1 ? "permission file" : "permission files"}`,
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

  if (totalGenerated === 0) {
    const enabledFeatures = features.join(", ");
    logger.info(`✓ All files are up to date (${enabledFeatures})`);
    return;
  }

  const parts = [];
  if (result.rulesCount > 0) parts.push(`${result.rulesCount} rules`);
  if (result.ignoreCount > 0) parts.push(`${result.ignoreCount} ignore files`);
  if (result.mcpCount > 0) parts.push(`${result.mcpCount} MCP files`);
  if (result.commandsCount > 0) parts.push(`${result.commandsCount} commands`);
  if (result.subagentsCount > 0) parts.push(`${result.subagentsCount} subagents`);
  if (result.skillsCount > 0) parts.push(`${result.skillsCount} skills`);
  if (result.hooksCount > 0) parts.push(`${result.hooksCount} hooks`);
  if (result.permissionsCount > 0) parts.push(`${result.permissionsCount} permissions`);

  if (isPreview) {
    logger.info(`${modePrefix} Would write ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  } else {
    logger.success(`🎉 All done! Written ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }

  // Handle --check mode exit code
  if (check) {
    if (result.hasDiff) {
      throw new CLIError(
        "Files are not up to date. Run 'rulesync generate' to update.",
        ErrorCodes.GENERATION_FAILED,
      );
    } else {
      logger.success("✓ All files are up to date.");
    }
  }
}
