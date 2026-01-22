import type { ToolTarget } from "../types/tool-targets.js";

import { ConfigResolver, ConfigResolverResolveParams } from "../config/config-resolver.js";
import { Config } from "../config/config.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";

export type ImportFromParams = Omit<ConfigResolverResolveParams, "delete">;

/**
 * Import configurations from AI tools to rulesync format.
 *
 * @param params - Import parameters (must include exactly one target)
 * @returns The total number of files imported
 * @throws Error if no target is specified or multiple targets are specified
 *
 * @example
 * ```typescript
 * import { importFrom } from "rulesync";
 *
 * const totalImported = await importFrom({
 *   targets: ["claudecode"],
 *   features: ["rules", "commands"],
 * });
 * console.log(`Imported ${totalImported} files`);
 * ```
 */
export async function importFrom(params: ImportFromParams): Promise<number> {
  if (!params.targets) {
    throw new Error("No tools found in targets");
  }

  if (params.targets.length > 1) {
    throw new Error("Only one tool can be imported at a time");
  }

  const config = await ConfigResolver.resolve(params);

  // eslint-disable-next-line no-type-assertion/no-type-assertion
  const tool = config.getTargets()[0]!;

  let totalImported = 0;

  // Import rule files using RulesProcessor if rules feature is enabled
  totalImported += await importRules(config, tool);

  // Process ignore files if ignore feature is enabled
  totalImported += await importIgnore(config, tool);

  // Create MCP files if mcp feature is enabled
  totalImported += await importMcp(config, tool);

  // Create command files using CommandsProcessor if commands feature is enabled
  totalImported += await importCommands(config, tool);

  // Create subagent files if subagents feature is enabled
  totalImported += await importSubagents(config, tool);

  // Create skill files if skills feature is enabled
  totalImported += await importSkills(config, tool);

  return totalImported;
}

async function importRules(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("rules")) {
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
  });

  const toolFiles = await rulesProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await rulesProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await rulesProcessor.writeAiFiles(rulesyncFiles);

  return writtenCount;
}

async function importIgnore(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("ignore")) {
    return 0;
  }

  if (config.getGlobal()) {
    return 0;
  }

  if (!IgnoreProcessor.getToolTargets().includes(tool)) {
    return 0;
  }

  const ignoreProcessor = new IgnoreProcessor({
    baseDir: config.getBaseDirs()[0] ?? ".",
    toolTarget: tool,
  });

  const toolFiles = await ignoreProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await ignoreProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await ignoreProcessor.writeAiFiles(rulesyncFiles);

  return writtenCount;
}

async function importMcp(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("mcp")) {
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
  });

  const toolFiles = await mcpProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await mcpProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await mcpProcessor.writeAiFiles(rulesyncFiles);

  return writtenCount;
}

async function importCommands(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("commands")) {
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
  });

  const toolFiles = await commandsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await commandsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await commandsProcessor.writeAiFiles(rulesyncFiles);

  return writtenCount;
}

async function importSubagents(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("subagents")) {
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
  });

  const toolFiles = await subagentsProcessor.loadToolFiles();
  if (toolFiles.length === 0) {
    return 0;
  }

  const rulesyncFiles = await subagentsProcessor.convertToolFilesToRulesyncFiles(toolFiles);
  const writtenCount = await subagentsProcessor.writeAiFiles(rulesyncFiles);

  return writtenCount;
}

async function importSkills(config: Config, tool: ToolTarget): Promise<number> {
  if (!config.getFeatures().includes("skills")) {
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
  });

  const toolDirs = await skillsProcessor.loadToolDirs();
  if (toolDirs.length === 0) {
    return 0;
  }

  const rulesyncDirs = await skillsProcessor.convertToolDirsToRulesyncDirs(toolDirs);
  const writtenCount = await skillsProcessor.writeAiDirs(rulesyncDirs);

  return writtenCount;
}
