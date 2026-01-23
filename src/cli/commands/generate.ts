import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { checkRulesyncDirExists, generate } from "../../lib/generate.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  logger.configure({
    verbose: config.getVerbose(),
    silent: config.getSilent(),
  });

  logger.info("Generating files...");

  if (!(await checkRulesyncDirExists({ baseDir: config.getBaseDirs()[0] ?? process.cwd() }))) {
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
  if (features.includes("rules")) {
    logger.info("Generating rule files...");
  }

  const result = await generate({ config });

  if (result.ignoreCount > 0) {
    logger.success(`Generated ${result.ignoreCount} ignore file(s)`);
  }
  if (result.mcpCount > 0) {
    logger.success(`Generated ${result.mcpCount} MCP configuration(s)`);
  }
  if (result.commandsCount > 0) {
    logger.success(`Generated ${result.commandsCount} command(s)`);
  }
  if (result.subagentsCount > 0) {
    logger.success(`Generated ${result.subagentsCount} subagent(s)`);
  }
  if (result.skillsCount > 0) {
    logger.success(`Generated ${result.skillsCount} skill(s)`);
  }
  if (result.rulesCount > 0) {
    logger.success(`Generated ${result.rulesCount} rule(s)`);
  }

  const totalGenerated =
    result.rulesCount +
    result.ignoreCount +
    result.mcpCount +
    result.commandsCount +
    result.subagentsCount +
    result.skillsCount;

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

  logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`);
}
