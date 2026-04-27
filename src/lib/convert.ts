import { Config } from "../config/config.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import type { Feature } from "../types/features.js";
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

type ConvertContext = {
  config: Config;
  fromTool: ToolTarget;
  toTools: ToolTarget[];
  logger: Logger;
};

/**
 * Generic strategy describing how to run a single-feature conversion.
 *
 * `loadSource` / `toRulesync` / `fromRulesync` / `write` are processor-specific
 * adapter callbacks so this helper can drive both file-based processors
 * (`FeatureProcessor`) and the directory-based `SkillsProcessor` uniformly.
 */
type ConvertStrategy<TProcessor, TSourceItem, TRulesyncItem> = {
  feature: Feature;
  itemLabel: string;
  allTargets: readonly ToolTarget[];
  importableTargets?: readonly ToolTarget[];
  createProcessor: (params: { toolTarget: ToolTarget; dryRun: boolean }) => TProcessor;
  loadSource: (processor: TProcessor) => Promise<TSourceItem[]>;
  toRulesync: (processor: TProcessor, items: TSourceItem[]) => Promise<TRulesyncItem[]>;
  fromRulesync: (processor: TProcessor, items: TRulesyncItem[]) => Promise<TSourceItem[]>;
  write: (processor: TProcessor, items: TSourceItem[]) => Promise<{ count: number }>;
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
  const ctx: ConvertContext = params;

  const [
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount,
    hooksCount,
    permissionsCount,
  ] = [
    await runFeatureConvert(ctx, buildRulesStrategy(ctx)),
    await runFeatureConvert(ctx, buildIgnoreStrategy(ctx)),
    await runFeatureConvert(ctx, buildMcpStrategy(ctx)),
    await runFeatureConvert(ctx, buildCommandsStrategy(ctx)),
    await runFeatureConvert(ctx, buildSubagentsStrategy(ctx)),
    await runFeatureConvert(ctx, buildSkillsStrategy(ctx)),
    await runFeatureConvert(ctx, buildHooksStrategy(ctx)),
    await runFeatureConvert(ctx, buildPermissionsStrategy(ctx)),
  ];

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

async function runFeatureConvert<TProcessor, TSourceItem, TRulesyncItem>(
  ctx: ConvertContext,
  strategy: ConvertStrategy<TProcessor, TSourceItem, TRulesyncItem> | null,
): Promise<number> {
  if (!strategy) return 0;
  const { config, fromTool, toTools, logger } = ctx;
  const {
    feature,
    itemLabel,
    allTargets,
    importableTargets = allTargets,
    createProcessor,
    loadSource,
    toRulesync,
    fromRulesync,
    write,
  } = strategy;

  if (!config.getFeatures(fromTool).includes(feature)) {
    return 0;
  }

  if (!allTargets.includes(fromTool)) {
    logger.warn(`Source tool '${fromTool}' does not support feature '${feature}'. Skipping.`);
    return 0;
  }

  if (!importableTargets.includes(fromTool)) {
    logger.warn(`Conversion from ${fromTool} ${feature} is not supported. Skipping.`);
    return 0;
  }

  const sourceProcessor = createProcessor({ toolTarget: fromTool, dryRun: false });
  const sourceItems = await loadSource(sourceProcessor);
  if (sourceItems.length === 0) {
    logger.warn(`No ${feature} files found for ${fromTool}. Skipping ${feature} conversion.`);
    return 0;
  }

  const rulesyncItems = await toRulesync(sourceProcessor, sourceItems);

  let totalCount = 0;
  for (const toTool of toTools) {
    if (!allTargets.includes(toTool)) {
      logger.warn(`Destination tool '${toTool}' does not support feature '${feature}'. Skipping.`);
      continue;
    }

    const destProcessor = createProcessor({
      toolTarget: toTool,
      dryRun: config.isPreviewMode(),
    });

    const destItems = await fromRulesync(destProcessor, rulesyncItems);
    const { count } = await write(destProcessor, destItems);
    totalCount += count;

    if (config.getVerbose() && count > 0) {
      const verb = config.isPreviewMode() ? "Would convert" : "Converted";
      logger.success(`${verb} ${count} ${itemLabel} for ${toTool}`);
    }
  }

  return totalCount;
}

function getOutputRoot(config: Config): string {
  return config.getOutputRoots()[0] ?? ".";
}

function buildRulesStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = RulesProcessor.getToolTargets({ global });

  return {
    feature: "rules" as const,
    itemLabel: "rule file(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new RulesProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    RulesProcessor,
    Awaited<ReturnType<RulesProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<RulesProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildIgnoreStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  if (config.getGlobal()) {
    logger.debug("Skipping ignore conversion (not supported in global mode)");
    return null;
  }
  const outputRoot = getOutputRoot(config);
  const allTargets = IgnoreProcessor.getToolTargets();

  return {
    feature: "ignore" as const,
    itemLabel: "ignore file(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new IgnoreProcessor({
        outputRoot,
        toolTarget,
        dryRun,
        logger,
        featureOptions: config.getFeatureOptions(toolTarget, "ignore"),
      }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    IgnoreProcessor,
    Awaited<ReturnType<IgnoreProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<IgnoreProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildMcpStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = McpProcessor.getToolTargets({ global });

  return {
    feature: "mcp" as const,
    itemLabel: "MCP file(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new McpProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    McpProcessor,
    Awaited<ReturnType<McpProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<McpProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildCommandsStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = CommandsProcessor.getToolTargets({ global, includeSimulated: false });

  return {
    feature: "commands" as const,
    itemLabel: "command file(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new CommandsProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    CommandsProcessor,
    Awaited<ReturnType<CommandsProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<CommandsProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildSubagentsStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = SubagentsProcessor.getToolTargets({ global, includeSimulated: false });

  return {
    feature: "subagents" as const,
    itemLabel: "subagent file(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new SubagentsProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    SubagentsProcessor,
    Awaited<ReturnType<SubagentsProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<SubagentsProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildSkillsStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = SkillsProcessor.getToolTargets({ global });

  return {
    feature: "skills" as const,
    itemLabel: "skill(s)",
    allTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new SkillsProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolDirs(),
    toRulesync: (p, dirs) => p.convertToolDirsToRulesyncDirs(dirs),
    fromRulesync: (p, dirs) => p.convertRulesyncDirsToToolDirs(dirs),
    write: (p, dirs) => p.writeAiDirs(dirs),
  } satisfies ConvertStrategy<
    SkillsProcessor,
    Awaited<ReturnType<SkillsProcessor["loadToolDirs"]>>[number],
    Awaited<ReturnType<SkillsProcessor["convertToolDirsToRulesyncDirs"]>>[number]
  >;
}

function buildHooksStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = HooksProcessor.getToolTargets({ global });
  const importableTargets = HooksProcessor.getToolTargets({ global, importOnly: true });

  return {
    feature: "hooks" as const,
    itemLabel: "hooks file(s)",
    allTargets,
    importableTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new HooksProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    HooksProcessor,
    Awaited<ReturnType<HooksProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<HooksProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}

function buildPermissionsStrategy(ctx: ConvertContext) {
  const { config, logger } = ctx;
  const global = config.getGlobal();
  const outputRoot = getOutputRoot(config);
  const allTargets = PermissionsProcessor.getToolTargets({ global });
  const importableTargets = PermissionsProcessor.getToolTargets({ global, importOnly: true });

  return {
    feature: "permissions" as const,
    itemLabel: "permissions file(s)",
    allTargets,
    importableTargets,
    createProcessor: ({ toolTarget, dryRun }) =>
      new PermissionsProcessor({ outputRoot, toolTarget, global, dryRun, logger }),
    loadSource: (p) => p.loadToolFiles(),
    toRulesync: (p, files) => p.convertToolFilesToRulesyncFiles(files),
    fromRulesync: (p, files) => p.convertRulesyncFilesToToolFiles(files),
    write: (p, files) => p.writeAiFiles(files),
  } satisfies ConvertStrategy<
    PermissionsProcessor,
    Awaited<ReturnType<PermissionsProcessor["loadToolFiles"]>>[number],
    Awaited<ReturnType<PermissionsProcessor["convertToolFilesToRulesyncFiles"]>>[number]
  >;
}
