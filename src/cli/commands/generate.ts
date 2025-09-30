import { intersection } from "es-toolkit";
import { CommandsProcessor } from "../../commands/commands-processor.js";
import { Config } from "../../config/config.js";
import { ConfigResolver, type ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor, type McpProcessorToolTarget } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import { fileExists } from "../../utils/file.js";
import { logger } from "../../utils/logger.js";

export type GenerateOptions = ConfigResolverResolveParams;

export async function generateCommand(options: GenerateOptions): Promise<void> {
  const config = await ConfigResolver.resolve(options);

  // Set logger verbosity based on config
  logger.setVerbose(config.getVerbose());

  logger.info("Generating files...");

  // Check if .rulesync directory exists
  if (!(await fileExists(".rulesync"))) {
    logger.error("❌ .rulesync directory not found. Run 'rulesync init' first.");
    process.exit(1);
  }

  logger.info(`Base directories: ${config.getBaseDirs().join(", ")}`);
  // Generate rule files (rules feature)
  const totalRulesOutputs = await generateRules(config);

  // Generate MCP configurations (mcp feature)
  const totalMcpOutputs = await generateMcp(config);

  // Generate command files (commands feature)
  const totalCommandOutputs = await generateCommands(config);

  // Generate ignore files (ignore feature)
  const totalIgnoreOutputs = await generateIgnore(config);

  // Generate subagent files (subagents feature)
  const totalSubagentOutputs = await generateSubagents(config);

  // Check if any features generated content
  const totalGenerated =
    totalRulesOutputs +
    totalMcpOutputs +
    totalCommandOutputs +
    totalIgnoreOutputs +
    totalSubagentOutputs;
  if (totalGenerated === 0) {
    const enabledFeatures = config.getFeatures().join(", ");
    logger.warn(`⚠️  No files generated for enabled features: ${enabledFeatures}`);
    return;
  }

  // Final success message
  if (totalGenerated > 0) {
    const parts = [];
    if (totalRulesOutputs > 0) parts.push(`${totalRulesOutputs} rules`);
    if (totalIgnoreOutputs > 0) parts.push(`${totalIgnoreOutputs} ignore files`);
    if (totalMcpOutputs > 0) parts.push(`${totalMcpOutputs} MCP files`);
    if (totalCommandOutputs > 0) parts.push(`${totalCommandOutputs} commands`);
    if (totalSubagentOutputs > 0) parts.push(`${totalSubagentOutputs} subagents`);

    logger.success(`🎉 All done! Generated ${totalGenerated} file(s) total (${parts.join(" + ")})`);
  }
}

async function generateRules(config: Config): Promise<number> {
  if (!config.getFeatures().includes("rules")) {
    logger.info("Skipping rule generation (not in --features)");
    return 0;
  }

  let totalRulesOutputs = 0;
  logger.info("Generating rule files...");

  if (config.getExperimentalGlobal()) {
    for (const toolTarget of intersection(
      config.getTargets(),
      RulesProcessor.getToolTargetsGlobal(),
    )) {
      const baseDir = ".";
      const processor = new RulesProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalRulesOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} rule(s) in ${baseDir}`);
    }

    return totalRulesOutputs;
  }

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of intersection(config.getTargets(), RulesProcessor.getToolTargets())) {
      const processor = new RulesProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        simulateCommands: config.getExperimentalSimulateCommands(),
        simulateSubagents: config.getExperimentalSimulateSubagents(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFilesToDelete();
        await processor.removeAiFiles(oldToolFiles);
      }

      let rulesyncFiles = await processor.loadRulesyncFiles();
      if (rulesyncFiles.length === 0) {
        rulesyncFiles = await processor.loadRulesyncFilesLegacy();
      }

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalRulesOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} rule(s) in ${baseDir}`);
    }
  }
  return totalRulesOutputs;
}

async function generateMcp(config: Config): Promise<number> {
  if (!config.getFeatures().includes("mcp")) {
    logger.info("Skipping MCP configuration generation (not in --features)");
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.info("Skipping MCP configuration generation (not supported in global mode)");
    return 0;
  }

  let totalMcpOutputs = 0;
  logger.info("Generating MCP files...");

  // Check which targets support MCP
  const supportedMcpTargets: McpProcessorToolTarget[] = [
    "amazonqcli",
    "claudecode",
    "cline",
    "copilot",
    "cursor",
    "roo",
  ];
  const mcpSupportedTargets = config
    .getTargets()
    .filter((target): target is McpProcessorToolTarget => {
      return supportedMcpTargets.some((supportedTarget) => supportedTarget === target);
    });

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of intersection(mcpSupportedTargets, McpProcessor.getToolTargets())) {
      const processor = new McpProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFilesToDelete();
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalMcpOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} MCP configuration(s) in ${baseDir}`);
    }
  }

  return totalMcpOutputs;
}

async function generateCommands(config: Config): Promise<number> {
  if (!config.getFeatures().includes("commands")) {
    logger.info("Skipping command file generation (not in --features)");
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.info("Skipping command file generation (not supported in global mode)");
    return 0;
  }

  let totalCommandOutputs = 0;
  logger.info("Generating command files...");

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of intersection(
      config.getTargets(),
      CommandsProcessor.getToolTargets({
        includeSimulated: config.getExperimentalSimulateCommands(),
      }),
    )) {
      const processor = new CommandsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFilesToDelete();
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCommandOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} command(s) in ${baseDir}`);
    }
  }

  return totalCommandOutputs;
}

async function generateIgnore(config: Config): Promise<number> {
  if (!config.getFeatures().includes("ignore")) {
    logger.info("Skipping ignore file generation (not in --features)");
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.info("Skipping ignore file generation (not supported in global mode)");
    return 0;
  }

  let totalIgnoreOutputs = 0;
  logger.info("Generating ignore files...");

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
        });

        if (config.getDelete()) {
          const oldToolFiles = await processor.loadToolFilesToDelete();
          await processor.removeAiFiles(oldToolFiles);
        }

        const rulesyncFiles = await processor.loadRulesyncFiles();
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
          const writtenCount = await processor.writeAiFiles(toolFiles);
          totalIgnoreOutputs += writtenCount;
          logger.success(`Generated ${writtenCount} ${toolTarget} ignore file(s) in ${baseDir}`);
        }
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${baseDir}:`,
          error instanceof Error ? error.message : String(error),
        );
        continue;
      }
    }
  }

  return totalIgnoreOutputs;
}

async function generateSubagents(config: Config): Promise<number> {
  if (!config.getFeatures().includes("subagents")) {
    logger.info("Skipping subagent file generation (not in --features)");
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.info("Skipping subagent file generation (not supported in global mode)");
    return 0;
  }

  let totalSubagentOutputs = 0;
  logger.info("Generating subagent files...");

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of intersection(
      config.getTargets(),
      SubagentsProcessor.getToolTargets({
        includeSimulated: config.getExperimentalSimulateSubagents(),
      }),
    )) {
      const processor = new SubagentsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFilesToDelete();
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalSubagentOutputs += writtenCount;
      logger.success(`Generated ${writtenCount} ${toolTarget} subagent(s) in ${baseDir}`);
    }
  }

  return totalSubagentOutputs;
}
