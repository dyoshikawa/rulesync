import { CommandsProcessor } from "../../commands/commands-processor.js";
import { Config } from "../../config/config.js";
import { ConfigResolver, ConfigResolverResolveParams } from "../../config/config-resolver.js";
import { IgnoreProcessor } from "../../ignore/ignore-processor.js";
import { McpProcessor } from "../../mcp/mcp-processor.js";
import { RulesProcessor } from "../../rules/rules-processor.js";
import { SubagentsProcessor } from "../../subagents/subagents-processor.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { logger } from "../../utils/logger.js";

export type ImportOptions = Omit<ConfigResolverResolveParams, "delete" | "baseDirs">;

export async function importCommand(options: ImportOptions): Promise<void> {
  if (!options.targets) {
    logger.error("No tools found in --targets");
    process.exit(1);
  }

  if (options.targets.length > 1) {
    logger.error("Only one tool can be imported at a time");
    process.exit(1);
  }

  const config = await ConfigResolver.resolve(options);

  // Set logger verbosity based on options
  logger.setVerbose(config.getVerbose());

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  // Import rule files using RulesProcessor if rules feature is enabled
  await importRules(config, tool);

  // Process ignore files if ignore feature is enabled
  await importIgnore(config, tool);

  // Create MCP files if mcp feature is enabled
  await importMcp(config, tool);

  // Create command files using CommandsProcessor if commands feature is enabled
  await importCommands(config, tool);

  // Create subagent files if subagents feature is enabled
  await importSubagents(config, tool);
}

async function importRules(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("rules")) {
    return 0;
  }

  if (!RulesProcessor.getToolTargets().includes(tool)) {
    return 0;
  }

  const global = config.getExperimentalGlobal();
  if (global && !RulesProcessor.getToolTargetsGlobal().includes(tool)) {
    logger.error(`${tool} is not supported in global mode`);
    return 0;
  }

  const rulesProcessor = new RulesProcessor({
    baseDir: ".",
    toolTarget: tool,
    global,
  });

  const toolFiles = await rulesProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await rulesProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} rule files`);
  }

  return writtenCount;
}

async function importIgnore(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("ignore")) {
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.debug("Skipping ignore file import (not supported in global mode)");
    return 0;
  }

  if (!IgnoreProcessor.getToolTargets().includes(tool)) {
    return 0;
  }

  const ignoreProcessor = new IgnoreProcessor({
    baseDir: ".",
    toolTarget: tool,
  });

  const toolFiles = await ignoreProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await ignoreProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose()) {
    logger.success(`Created ignore files from ${toolFiles.length} tool ignore configurations`);
  }

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} ignore files`);
  }

  return writtenCount;
}

async function importMcp(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("mcp")) {
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.debug("Skipping MCP file import (not supported in global mode)");
    return 0;
  }

  if (!McpProcessor.getToolTargets().includes(tool)) {
    return 0;
  }

  const mcpProcessor = new McpProcessor({
    baseDir: ".",
    toolTarget: tool,
  });

  const toolFiles = await mcpProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await mcpProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} MCP files`);
  }

  return writtenCount;
}

async function importCommands(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("commands")) {
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.debug("Skipping command file import (not supported in global mode)");
    return 0;
  }

  // Use CommandsProcessor for supported tools, excluding simulated ones
  const supportedTargets = CommandsProcessor.getToolTargets({ includeSimulated: false });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const commandsProcessor = new CommandsProcessor({
    baseDir: ".",
    toolTarget: tool,
  });

  const toolFiles = await commandsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await commandsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} command files`);
  }

  return writtenCount;
}

async function importSubagents(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("subagents")) {
    return 0;
  }

  if (config.getExperimentalGlobal()) {
    logger.debug("Skipping subagent file import (not supported in global mode)");
    return 0;
  }

  // Use SubagentsProcessor for supported tools, excluding simulated ones
  const supportedTargets = SubagentsProcessor.getToolTargets({ includeSimulated: false });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const subagentsProcessor = new SubagentsProcessor({
    baseDir: ".",
    toolTarget: tool,
  });

  const toolFiles = await subagentsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await subagentsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} subagent files`);
  }

  return writtenCount;
}
