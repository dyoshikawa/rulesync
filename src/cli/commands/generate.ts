import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { checkRulesyncDirExists, generate } from "../../lib/generate.js";
import { logger } from "../../utils/logger.js";
import { calculateTotalCount } from "../../utils/result.js";

export type GenerateOptions = ConfigResolverResolveParams;

/**
 * Log feature generation result with appropriate prefix based on preview mode.
 */
function logFeatureResult(params: {
  count: number;
  featureName: string;
  isPreview: boolean;
  modePrefix: string;
}): void {
  const { count, featureName, isPreview, modePrefix } = params;
  if (count > 0) {
    if (isPreview) {
      logger.info(`${modePrefix} Would generate ${count} ${featureName}`);
    } else {
      logger.success(`Generated ${count} ${featureName}`);
    }
  }
}

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent(),
  });

  const dryRun = config.getDryRun();
  const check = config.getCheck();

  // Validate --dry-run and --check are mutually exclusive
  if (dryRun && check) {
    logger.error("❌ --dry-run and --check cannot be used together");
    process.exit(1);
  }

  const isPreview = config.isPreviewMode();
  const modePrefix = isPreview ? "[PREVIEW]" : "";

  logger.info("Generating files...");

  if (!(await checkRulesyncDirExists({ baseDir: process.cwd() }))) {
    logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  logger.info(`Base directories: ${config.getBaseDirs().join(", ")}`);

  const features = config.getFeatures();

  if (features.includes("ignore")) {
    logger.info("Generating ignore files...");
  }
  if (features.includes("mcp")) {
    logger.info("Generating MCP files...");
    if (config.getModularMcp()) {
      logger.info("ℹ️  Modular MCP support is experimental.");
    }
  }
  if (features.includes("commands")) {
    logger.info("Generating command files...");
  }
  if (features.includes("subagents")) {
    logger.info("Generating subagent files...");
  }
  if (features.includes("skills")) {
    logger.info("Generating skill files...");
  }
  if (features.includes("hooks")) {
    logger.info("Generating hooks...");
  }
  if (features.includes("rules")) {
    logger.info("Generating rule files...");
  }

  const result = await generate({ config });

  logFeatureResult({
    count: result.ignoreCount,
    featureName: "ignore file(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.mcpCount,
    featureName: "MCP configuration(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.commandsCount,
    featureName: "command(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.subagentsCount,
    featureName: "subagent(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.skillsCount,
    featureName: "skill(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.hooksCount,
    featureName: "hooks file(s)",
    isPreview,
    modePrefix,
  });
  logFeatureResult({
    count: result.rulesCount,
    featureName: "rule(s)",
    isPreview,
    modePrefix,
  });

  const totalGenerated = calculateTotalCount(result);

  if (totalGenerated === 0) {
    const enabledFeatures = features.join(", ");
    logger.warn(`⚠️  No files generated for enabled features: ${enabledFeatures}`);
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

  if (isPreview) {
    logger.info(
      `${modePrefix} Would generate ${totalGenerated} file(s) total (${parts.join(" + ")})`,
    );
  } else {
    logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }

  // Handle --check mode exit code
  if (check) {
    if (result.hasDiff) {
      logger.error("❌ Files are not up to date. Run 'rulesync generate' to update.");
      process.exit(1);
    } else {
      logger.success("✓ All files are up to date.");
    }
  }
}
