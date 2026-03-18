import { Config } from "../config/config.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { ToolTarget } from "../types/tool-targets.js";
import type { Logger } from "../utils/logger.js";

export type ImportResult = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  permissionsCount: number;
};

/**
 * Import configuration files from AI tools.
 */
export async function importFromTool(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<ImportResult> {
  const { config, tool, logger } = params;

  validateClaudecodeIgnorePermissionsConflict({ config, tool });

  const rulesCount = await importRulesCore({ config, tool, logger });
  const ignoreCount = await importIgnoreCore({ config, tool, logger });
  const mcpCount = await importMcpCore({ config, tool, logger });
  const commandsCount = await importCommandsCore({ config, tool, logger });
  const subagentsCount = await importSubagentsCore({ config, tool, logger });
  const skillsCount = await importSkillsCore({ config, tool, logger });
  const hooksCount = await importHooksCore({ config, tool, logger });
  const permissionsCount = await importPermissionsCore({ config, tool, logger });

  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount,
    hooksCount,
    permissionsCount,
  };
}

function validateClaudecodeIgnorePermissionsConflict(params: {
  config: Config;
  tool: ToolTarget;
}): void {
  const { config, tool } = params;
  if (tool !== "claudecode") {
    return;
  }

  const features = config.getFeatures("claudecode");
  if (features.includes("ignore") && features.includes("permissions")) {
    throw new Error(
      "Claude Code ignore and permissions cannot be imported together. Run them in separate operations.",
    );
  }
}

async function importRulesCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("rules")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = RulesProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const rulesProcessor = new RulesProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await rulesProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No rule files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await rulesProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} rule files`);
  }

  return writtenCount;
}

async function importIgnoreCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("ignore")) {
    return 0;
  }

  if (config.getGlobal()) {
    logger.debug("Skipping ignore file import (not supported in global mode)");
    return 0;
  }

  if (!IgnoreProcessor.getToolTargets().includes(tool)) {
    return 0;
  }

  const ignoreProcessor = new IgnoreProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    logger,
  });

  const toolFiles = await ignoreProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No ignore files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await ignoreProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose()) {
    logger.success(`Created ignore files from ${toolFiles.length} tool ignore configurations`);
  }

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} ignore files`);
  }

  return writtenCount;
}

async function importMcpCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("mcp")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = McpProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const mcpProcessor = new McpProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await mcpProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No MCP files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await mcpProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} MCP files`);
  }

  return writtenCount;
}

async function importCommandsCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("commands")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = CommandsProcessor.getToolTargets({ global, includeSimulated: false });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const commandsProcessor = new CommandsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await commandsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No command files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await commandsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} command files`);
  }

  return writtenCount;
}

async function importSubagentsCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("subagents")) {
    return 0;
  }

  // Use SubagentsProcessor for supported tools, excluding simulated ones
  const global = config.getGlobal();
  const supportedTargets = SubagentsProcessor.getToolTargets({ global, includeSimulated: false });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const subagentsProcessor = new SubagentsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global: config.getGlobal(),
    logger,
  });

  const toolFiles = await subagentsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No subagent files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await subagentsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} subagent files`);
  }

  return writtenCount;
}

async function importSkillsCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("skills")) {
    return 0;
  }

  const global = config.getGlobal();

  const supportedTargets = SkillsProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const skillsProcessor = new SkillsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolDirs = await skillsProcessor.loadToolDirs();
  if (toolDirs.length === 0) {
    logger.warn(`No skill directories found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncDirs = await skillsProcessor.convertToolDirsToRulesyncDirs(toolDirs);
  const { count: writtenCount } = await skillsProcessor.writeAiDirs(rulesyncDirs);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} skill directories`);
  }

  return writtenCount;
}

async function importHooksCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("hooks")) {
    return 0;
  }

  const global = config.getGlobal();
  const allTargets = HooksProcessor.getToolTargets({ global });
  const importableTargets = HooksProcessor.getToolTargets({ global, importOnly: true });

  if (!allTargets.includes(tool)) {
    return 0;
  }

  if (!importableTargets.includes(tool)) {
    logger.warn(`Import is not supported for ${tool} hooks. Skipping.`);
    return 0;
  }

  const hooksProcessor = new HooksProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await hooksProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No hooks files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await hooksProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await hooksProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} hooks file(s)`);
  }

  return writtenCount;
}

async function importPermissionsCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("permissions")) {
    return 0;
  }

  const allTargets = PermissionsProcessor.getToolTargets();
  const importableTargets = PermissionsProcessor.getToolTargets({ importOnly: true });

  if (!allTargets.includes(tool)) {
    return 0;
  }

  if (!importableTargets.includes(tool)) {
    logger.warn(`Import is not supported for ${tool} permissions. Skipping.`);
    return 0;
  }

  const permissionsProcessor = new PermissionsProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
  });

  const toolFiles = await permissionsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No permissions files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await permissionsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await permissionsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} permissions file(s)`);
  }

  return writtenCount;
}
