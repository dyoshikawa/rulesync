import { Config } from "../config/config.js";
import { ChecksProcessor } from "../features/checks/checks-processor.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { RulesyncHooks } from "../features/hooks/rulesync-hooks.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesyncPermissions } from "../features/permissions/rulesync-permissions.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { resolveToolOutputRoot } from "../utils/kimi-code.js";
import type { Logger } from "../utils/logger.js";
import { assertPluginRootSafe, isPackagingToolTarget } from "../utils/plugin-root.js";
import {
  resolveRulesyncSourceWritePath,
  type RulesyncSourceSettablePaths,
} from "../utils/rulesync-source-path.js";

async function applyRulesyncSourcePath<T extends RulesyncFile>({
  files,
  paths,
  sourceClass,
  outputRoot,
}: {
  files: T[];
  paths: RulesyncSourceSettablePaths;
  sourceClass: new (params: RulesyncFileParams) => T;
  outputRoot?: string;
}): Promise<T[]> {
  const first = files[0];
  if (!first) {
    return files;
  }

  const destinationOutputRoot = outputRoot ?? first.getOutputRoot();
  const destination = await resolveRulesyncSourceWritePath({
    outputRoot: destinationOutputRoot,
    paths,
  });
  return files.map(
    (file) =>
      new sourceClass({
        outputRoot: destinationOutputRoot,
        relativeDirPath: destination.relativeDirPath,
        relativeFilePath: destination.relativeFilePath,
        fileContent: file.getFileContent(),
        validate: true,
      }),
  );
}

export type ImportResult = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  permissionsCount: number;
  checksCount: number;
};

function getToolOutputRoot({ config, tool }: { config: Config; tool: ToolTarget }): string {
  return resolveToolOutputRoot({
    outputRoot: config.getOutputRoots(tool)[0] ?? ".",
    toolTarget: tool,
    global: config.getGlobal(),
  });
}

/**
 * Import configuration files from AI tools.
 */
export async function importFromTool(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<ImportResult> {
  const { config, tool, logger } = params;

  await assertPluginRootSafe({
    toolTarget: tool,
    outputRoot: getToolOutputRoot({ config, tool }),
  });

  const rulesCount = await importRulesCore({ config, tool, logger });
  const ignoreCount = await importIgnoreCore({ config, tool, logger });
  const mcpCount = await importMcpCore({ config, tool, logger });
  const commandsCount = await importCommandsCore({ config, tool, logger });
  const subagentsCount = await importSubagentsCore({ config, tool, logger });
  const skillsCount = await importSkillsCore({ config, tool, logger });
  const hooksCount = await importHooksCore({ config, tool, logger });
  const permissionsCount = await importPermissionsCore({ config, tool, logger });
  const checksCount = await importChecksCore({ config, tool, logger });

  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount,
    hooksCount,
    permissionsCount,
    checksCount,
  };
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
    outputRoot: getToolOutputRoot({ config, tool }),
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

  const global = config.getGlobal();
  if (!IgnoreProcessor.getToolTargets({ global }).includes(tool)) {
    return 0;
  }

  const ignoreProcessor = new IgnoreProcessor({
    outputRoot: getToolOutputRoot({ config, tool }),
    toolTarget: tool,
    global,
    logger,
    featureOptions: config.getFeatureOptions(tool, "ignore"),
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
    outputRoot: getToolOutputRoot({ config, tool }),
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await mcpProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No MCP files found for ${tool}. Skipping import.`);
    return 0;
  }

  const convertedFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const rulesyncFiles = await applyRulesyncSourcePath({
    files: convertedFiles,
    paths: RulesyncMcp.getSettablePaths(),
    sourceClass: RulesyncMcp,
    outputRoot: isPackagingToolTarget(tool) ? process.cwd() : undefined,
  });
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
    outputRoot: getToolOutputRoot({ config, tool }),
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
    outputRoot: getToolOutputRoot({ config, tool }),
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
    outputRoot: getToolOutputRoot({ config, tool }),
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
  const rebasedRulesyncDirs = rulesyncDirs.map((dir) => {
    if (!isPackagingToolTarget(tool)) {
      return dir;
    }
    if (!(dir instanceof RulesyncSkill)) {
      return dir;
    }
    return new RulesyncSkill({
      outputRoot: process.cwd(),
      relativeDirPath: dir.getRelativeDirPath(),
      dirName: dir.getDirName(),
      frontmatter: dir.getFrontmatter(),
      body: dir.getBody(),
      otherFiles: dir.getOtherFiles(),
      validate: true,
      global: false,
    });
  });
  const { count: writtenCount } = await skillsProcessor.writeAiDirs(rebasedRulesyncDirs);

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
    outputRoot: getToolOutputRoot({ config, tool }),
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await hooksProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No hooks files found for ${tool}. Skipping import.`);
    return 0;
  }

  const convertedFiles = await hooksProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const rulesyncFiles = await applyRulesyncSourcePath({
    files: convertedFiles,
    paths: RulesyncHooks.getSettablePaths(),
    sourceClass: RulesyncHooks,
    outputRoot: isPackagingToolTarget(tool) ? process.cwd() : undefined,
  });
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

  const allTargets = PermissionsProcessor.getToolTargets({ global: config.getGlobal() });
  const importableTargets = PermissionsProcessor.getToolTargets({
    global: config.getGlobal(),
    importOnly: true,
  });

  if (!allTargets.includes(tool)) {
    return 0;
  }

  if (!importableTargets.includes(tool)) {
    logger.warn(`Import is not supported for ${tool} permissions. Skipping.`);
    return 0;
  }

  const permissionsProcessor = new PermissionsProcessor({
    outputRoot: getToolOutputRoot({ config, tool }),
    toolTarget: tool,
    global: config.getGlobal(),
    logger,
  });

  const toolFiles = await permissionsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No permissions files found for ${tool}. Skipping import.`);
    return 0;
  }

  const convertedFiles = await permissionsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const rulesyncFiles = await applyRulesyncSourcePath({
    files: convertedFiles,
    paths: RulesyncPermissions.getSettablePaths(),
    sourceClass: RulesyncPermissions,
  });
  const { count: writtenCount } = await permissionsProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} permissions file(s)`);
  }

  return writtenCount;
}

async function importChecksCore(params: {
  config: Config;
  tool: ToolTarget;
  logger: Logger;
}): Promise<number> {
  const { config, tool, logger } = params;

  if (!config.getFeatures(tool).includes("checks")) {
    return 0;
  }

  const global = config.getGlobal();
  const supportedTargets = ChecksProcessor.getToolTargets({ global });
  if (!supportedTargets.includes(tool)) {
    return 0;
  }

  const checksProcessor = new ChecksProcessor({
    outputRoot: config.getOutputRoots()[0] ?? ".",
    toolTarget: tool,
    global,
    logger,
  });

  const toolFiles = await checksProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    logger.warn(`No check files found for ${tool}. Skipping import.`);
    return 0;
  }

  const rulesyncFiles = await checksProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const { count: writtenCount } = await checksProcessor.writeAiFiles(rulesyncFiles);

  if (config.getVerbose() && writtenCount > 0) {
    logger.success(`Created ${writtenCount} check files`);
  }

  return writtenCount;
}
