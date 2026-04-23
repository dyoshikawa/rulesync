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

export type ConvertResult = {
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
 * Convert configuration files between AI tools without writing intermediate
 * `.rulesync/` files to disk. Rulesync file instances live in memory only.
 */
export async function convertFromTool(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<ConvertResult> {
  const { config, fromTool, toTools, logger } = params;

  const rulesCount = await convertRulesCore({ config, fromTool, toTools, logger });
  const ignoreCount = await convertIgnoreCore({ config, fromTool, toTools, logger });
  const mcpCount = await convertMcpCore({ config, fromTool, toTools, logger });
  const commandsCount = await convertCommandsCore({ config, fromTool, toTools, logger });
  const subagentsCount = await convertSubagentsCore({ config, fromTool, toTools, logger });
  const skillsCount = await convertSkillsCore({ config, fromTool, toTools, logger });
  const hooksCount = await convertHooksCore({ config, fromTool, toTools, logger });
  const permissionsCount = await convertPermissionsCore({ config, fromTool, toTools, logger });

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

async function convertRulesCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("rules")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = RulesProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'rules'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new RulesProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No rule files found for ${fromTool}. Skipping rules conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'rules'. Skipping.`);
      continue;
    }

    const destProcessor = new RulesProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} rule file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertIgnoreCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("ignore")) {
    return 0;
  }

  if (config.getGlobal()) {
    logger.debug("Skipping ignore conversion (not supported in global mode)");
    return 0;
  }

  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = IgnoreProcessor.getToolTargets();

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'ignore'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new IgnoreProcessor({
    baseDir,
    toolTarget: fromTool,
    logger,
    featureOptions: config.getFeatureOptions(fromTool, "ignore"),
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No ignore files found for ${fromTool}. Skipping ignore conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'ignore'. Skipping.`);
      continue;
    }

    const destProcessor = new IgnoreProcessor({
      baseDir,
      toolTarget: toTool,
      dryRun: config.getDryRun(),
      logger,
      featureOptions: config.getFeatureOptions(toTool, "ignore"),
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} ignore file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertMcpCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("mcp")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = McpProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'mcp'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new McpProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No MCP files found for ${fromTool}. Skipping mcp conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'mcp'. Skipping.`);
      continue;
    }

    const destProcessor = new McpProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} MCP file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertCommandsCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("commands")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = CommandsProcessor.getToolTargets({ global, includeSimulated: false });

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'commands'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new CommandsProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No command files found for ${fromTool}. Skipping commands conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'commands'. Skipping.`);
      continue;
    }

    const destProcessor = new CommandsProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} command file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertSubagentsCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("subagents")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = SubagentsProcessor.getToolTargets({ global, includeSimulated: false });

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'subagents'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new SubagentsProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No subagent files found for ${fromTool}. Skipping subagents conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'subagents'. Skipping.`);
      continue;
    }

    const destProcessor = new SubagentsProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} subagent file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertSkillsCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("skills")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const supportedTargets = SkillsProcessor.getToolTargets({ global });

  if (!supportedTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'skills'. Skipping.`);
    return 0;
  }

  const sourceProcessor = new SkillsProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolDirs = await sourceProcessor.loadToolDirs();
  if (toolDirs.length === 0) {
    logger.warn(`No skill directories found for ${fromTool}. Skipping skills conversion.`);
    return 0;
  }

  const rulesyncDirs = await sourceProcessor.convertToolDirsToRulesyncDirs(toolDirs);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!supportedTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'skills'. Skipping.`);
      continue;
    }

    const destProcessor = new SkillsProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolDirs = await destProcessor.convertRulesyncDirsToToolDirs(rulesyncDirs);
    const { count } = await destProcessor.writeAiDirs(destToolDirs);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} skill(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertHooksCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("hooks")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const allTargets = HooksProcessor.getToolTargets({ global });
  const importableTargets = HooksProcessor.getToolTargets({ global, importOnly: true });

  if (!allTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'hooks'. Skipping.`);
    return 0;
  }

  if (!importableTargets.includes(fromTool)) {
    logger.warn(`Conversion from ${fromTool} hooks is not supported. Skipping.`);
    return 0;
  }

  const sourceProcessor = new HooksProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No hooks files found for ${fromTool}. Skipping hooks conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!allTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'hooks'. Skipping.`);
      continue;
    }

    const destProcessor = new HooksProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} hooks file(s) for ${toTool}`);
    }
  }

  return totalCount;
}

async function convertPermissionsCore(params: {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
}): Promise<number> {
  const { config, fromTool, toTools, logger } = params;

  if (!config.getFeatures(fromTool).includes("permissions")) {
    return 0;
  }

  const global = config.getGlobal();
  const baseDir = config.getBaseDirs()[0] ?? ".";
  const allTargets = PermissionsProcessor.getToolTargets({ global });
  const importableTargets = PermissionsProcessor.getToolTargets({ global, importOnly: true });

  if (!allTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature 'permissions'. Skipping.`);
    return 0;
  }

  if (!importableTargets.includes(fromTool)) {
    logger.warn(`Conversion from ${fromTool} permissions is not supported. Skipping.`);
    return 0;
  }

  const sourceProcessor = new PermissionsProcessor({
    baseDir,
    toolTarget: fromTool,
    global,
    logger,
  });

  const toolFiles = await sourceProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No permissions files found for ${fromTool}. Skipping permissions conversion.`);
    return 0;
  }

  const rulesyncFiles = await sourceProcessor.convertToolFilesToRulesyncFiles(toolFiles);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!allTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature 'permissions'. Skipping.`);
      continue;
    }

    const destProcessor = new PermissionsProcessor({
      baseDir,
      toolTarget: toTool,
      global,
      dryRun: config.getDryRun(),
      logger,
    });

    const destToolFiles = await destProcessor.convertRulesyncFilesToToolFiles(rulesyncFiles);
    const { count } = await destProcessor.writeAiFiles(destToolFiles);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      logger.success(`Converted ${count} permissions file(s) for ${toTool}`);
    }
  }

  return totalCount;
}
