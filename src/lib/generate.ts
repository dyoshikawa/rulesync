import { join } from "node:path";

import { intersection } from "es-toolkit";

import { Config } from "../config/config.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { PermissionsProcessor } from "../features/permissions/permissions-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { AiDir } from "../types/ai-dir.js";
import { AiFile } from "../types/ai-file.js";
import { DirFeatureProcessor } from "../types/dir-feature-processor.js";
import { FeatureProcessor } from "../types/feature-processor.js";
import type { Feature } from "../types/features.js";
import type { RulesyncFile } from "../types/rulesync-file.js";
import type { ToolTarget } from "../types/tool-targets.js";
import { formatError } from "../utils/error.js";
import { fileExists } from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import type { FeatureGenerateResult } from "../utils/result.js";

export type GenerateResult = {
  rulesCount: number;
  rulesPaths: string[];
  ignoreCount: number;
  ignorePaths: string[];
  mcpCount: number;
  mcpPaths: string[];
  commandsCount: number;
  commandsPaths: string[];
  subagentsCount: number;
  subagentsPaths: string[];
  skillsCount: number;
  skillsPaths: string[];
  hooksCount: number;
  hooksPaths: string[];
  permissionsCount: number;
  permissionsPaths: string[];
  skills: RulesyncSkill[];
  hasDiff: boolean;
};

async function processFeatureGeneration<T extends AiFile>(params: {
  config: Config;
  processor: FeatureProcessor;
  toolFiles: T[];
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolFiles } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiFiles(toolFiles);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function processDirFeatureGeneration(params: {
  config: Config;
  processor: DirFeatureProcessor;
  toolDirs: AiDir[];
}): Promise<FeatureGenerateResult> {
  const { config, processor, toolDirs } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const writeResult = await processor.writeAiDirs(toolDirs);
  totalCount += writeResult.count;
  allPaths.push(...writeResult.paths);
  if (writeResult.count > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolDirs = await processor.loadToolDirsToDelete();

    const orphanCount = await processor.removeOrphanAiDirs(existingToolDirs, toolDirs);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

// Handle special case for empty rulesync files
async function processEmptyFeatureGeneration(params: {
  config: Config;
  processor: FeatureProcessor;
}): Promise<FeatureGenerateResult> {
  const { config, processor } = params;

  const totalCount = 0;
  let hasDiff = false;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, []);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, paths: [], hasDiff };
}

/**
 * Dispatch to processEmptyFeatureGeneration or processFeatureGeneration
 * based on whether rulesync files exist.
 */
async function processFeatureWithRulesyncFiles(params: {
  config: Config;
  processor: FeatureProcessor;
  rulesyncFiles: RulesyncFile[];
}): Promise<FeatureGenerateResult> {
  const { config, processor, rulesyncFiles } = params;
  if (rulesyncFiles.length === 0) {
    return processEmptyFeatureGeneration({ config, processor });
  }
  const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
  return processFeatureGeneration({ config, processor, toolFiles });
}

const SIMULATE_OPTION_MAP: Partial<Record<Feature, string>> = {
  commands: "--simulate-commands",
  subagents: "--simulate-subagents",
  skills: "--simulate-skills",
};

function warnUnsupportedTargets(params: {
  config: Config;
  supportedTargets: ToolTarget[];
  simulatedTargets?: ToolTarget[];
  featureName: Feature;
  logger: Logger;
}): void {
  const { config, supportedTargets, simulatedTargets = [], featureName, logger } = params;
  for (const target of config.getTargets()) {
    if (!supportedTargets.includes(target) && config.getFeatures(target).includes(featureName)) {
      const simulateOption = SIMULATE_OPTION_MAP[featureName];
      if (simulateOption && simulatedTargets.includes(target)) {
        logger.warn(
          `Target '${target}' only supports simulated '${featureName}'. Use '${simulateOption}' to enable it. Skipping.`,
        );
      } else {
        logger.warn(`Target '${target}' does not support the feature '${featureName}'. Skipping.`);
      }
    }
  }
}

/**
 * Check if .rulesync directory exists.
 */
export async function checkRulesyncDirExists(params: { outputRoot: string }): Promise<boolean> {
  return fileExists(join(params.outputRoot, RULESYNC_RELATIVE_DIR_PATH));
}

/**
 * Generate configuration files for AI tools.
 * @throws Error if generation fails
 */
export async function generate(params: {
  config: Config;
  logger: Logger;
}): Promise<GenerateResult> {
  const { config, logger } = params;

  const ignoreResult = await generateIgnoreCore({ config, logger });
  const mcpResult = await generateMcpCore({ config, logger });

  const commandsResult = await generateCommandsCore({ config, logger });
  const subagentsResult = await generateSubagentsCore({ config, logger });
  const skillsResult = await generateSkillsCore({ config, logger });
  const hooksResult = await generateHooksCore({ config, logger });
  // NOTE: Permissions MUST run after ignore. Both features write to `.claude/settings.json`
  // (ignore writes Read deny entries, permissions merges all permission arrays).
  // Permissions reads the file written by ignore and preserves non-managed entries.
  // Changing this order or parallelizing these calls will cause data loss.
  const permissionsResult = await generatePermissionsCore({ config, logger });
  const rulesResult = await generateRulesCore({ config, logger, skills: skillsResult.skills });

  const hasDiff =
    ignoreResult.hasDiff ||
    mcpResult.hasDiff ||
    commandsResult.hasDiff ||
    subagentsResult.hasDiff ||
    skillsResult.hasDiff ||
    hooksResult.hasDiff ||
    permissionsResult.hasDiff ||
    rulesResult.hasDiff;

  return {
    rulesCount: rulesResult.count,
    rulesPaths: rulesResult.paths,
    ignoreCount: ignoreResult.count,
    ignorePaths: ignoreResult.paths,
    mcpCount: mcpResult.count,
    mcpPaths: mcpResult.paths,
    commandsCount: commandsResult.count,
    commandsPaths: commandsResult.paths,
    subagentsCount: subagentsResult.count,
    subagentsPaths: subagentsResult.paths,
    skillsCount: skillsResult.count,
    skillsPaths: skillsResult.paths,
    hooksCount: hooksResult.count,
    hooksPaths: hooksResult.paths,
    permissionsCount: permissionsResult.count,
    permissionsPaths: permissionsResult.paths,
    skills: skillsResult.skills,
    hasDiff,
  };
}

async function generateRulesCore(params: {
  config: Config;
  logger: Logger;
  skills?: RulesyncSkill[];
}): Promise<FeatureGenerateResult> {
  const { config, logger, skills } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedTargets = RulesProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedTargets);
  warnUnsupportedTargets({ config, supportedTargets, featureName: "rules", logger });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if rules feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("rules")) {
        continue;
      }

      const processor = new RulesProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills: skills,
        featureOptions: config.getFeatureOptions(toolTarget, "rules"),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateIgnoreCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  const supportedIgnoreTargets = IgnoreProcessor.getToolTargets();
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedIgnoreTargets,
    featureName: "ignore",
    logger,
  });

  if (config.getGlobal()) {
    return { count: 0, paths: [], hasDiff: false };
  }

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  for (const toolTarget of intersection(config.getTargets(), supportedIgnoreTargets)) {
    // Check if ignore feature is enabled for this specific target
    if (!config.getFeatures(toolTarget).includes("ignore")) {
      continue;
    }

    for (const outputRoot of config.getOutputRoots()) {
      try {
        const processor = new IgnoreProcessor({
          // Pass `outputRoot` verbatim. The legacy
          // `outputRoot === process.cwd() ? "." : outputRoot` heuristic was a
          // leftover from before `outputRoots` was always resolved to absolute
          // paths in `ConfigResolver`; with that change it is now consistent
          // to pass the same `outputRoot` value the other processors receive.
          outputRoot,
          inputRoot: config.getInputRoot(),
          toolTarget,
          dryRun: config.isPreviewMode(),
          logger,
          featureOptions: config.getFeatureOptions(toolTarget, "ignore"),
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${outputRoot}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateMcpCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedMcpTargets = McpProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedMcpTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedMcpTargets,
    featureName: "mcp",
    logger,
  });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if mcp feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("mcp")) {
        continue;
      }

      const processor = new McpProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateCommandsCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedCommandsTargets = CommandsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateCommands(),
  });
  const toolTargets = intersection(config.getTargets(), supportedCommandsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedCommandsTargets,
    simulatedTargets: CommandsProcessor.getToolTargetsSimulated(),
    featureName: "commands",
    logger,
  });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if commands feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("commands")) {
        continue;
      }

      const processor = new CommandsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();

      const result = await processFeatureWithRulesyncFiles({
        config,
        processor,
        rulesyncFiles,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateSubagentsCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedSubagentsTargets = SubagentsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateSubagents(),
  });
  const toolTargets = intersection(config.getTargets(), supportedSubagentsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedSubagentsTargets,
    simulatedTargets: SubagentsProcessor.getToolTargetsSimulated(),
    featureName: "subagents",
    logger,
  });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if subagents feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("subagents")) {
        continue;
      }

      const processor = new SubagentsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generateSkillsCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult & { skills: RulesyncSkill[] }> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;
  const allSkills: RulesyncSkill[] = [];

  const supportedSkillsTargets = SkillsProcessor.getToolTargets({
    global: config.getGlobal(),
    includeSimulated: config.getSimulateSkills(),
  });
  const toolTargets = intersection(config.getTargets(), supportedSkillsTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedSkillsTargets,
    simulatedTargets: SkillsProcessor.getToolTargetsSimulated(),
    featureName: "skills",
    logger,
  });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if skills feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("skills")) {
        continue;
      }

      const processor = new SkillsProcessor({
        outputRoot: outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncDirs = await processor.loadRulesyncDirs();

      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);

      const result = await processDirFeatureGeneration({
        config,
        processor,
        toolDirs,
      });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, skills: allSkills, hasDiff };
}

async function generateHooksCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  const supportedHooksTargets = HooksProcessor.getToolTargets({ global: config.getGlobal() });
  const toolTargets = intersection(config.getTargets(), supportedHooksTargets);
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedHooksTargets,
    featureName: "hooks",
    logger,
  });

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of toolTargets) {
      // Check if hooks feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("hooks")) {
        continue;
      }

      const processor = new HooksProcessor({
        outputRoot,
        inputRoot: config.getInputRoot(),
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
        logger,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

      totalCount += result.count;
      allPaths.push(...result.paths);
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}

async function generatePermissionsCore(params: {
  config: Config;
  logger: Logger;
}): Promise<FeatureGenerateResult> {
  const { config, logger } = params;

  const supportedPermissionsTargets = PermissionsProcessor.getToolTargets({
    global: config.getGlobal(),
  });
  warnUnsupportedTargets({
    config,
    supportedTargets: supportedPermissionsTargets,
    featureName: "permissions",
    logger,
  });

  let totalCount = 0;
  const allPaths: string[] = [];
  let hasDiff = false;

  for (const outputRoot of config.getOutputRoots()) {
    for (const toolTarget of intersection(config.getTargets(), supportedPermissionsTargets)) {
      if (!config.getFeatures(toolTarget).includes("permissions")) {
        continue;
      }

      try {
        const processor = new PermissionsProcessor({
          outputRoot,
          inputRoot: config.getInputRoot(),
          toolTarget,
          global: config.getGlobal(),
          dryRun: config.isPreviewMode(),
          logger,
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        const result = await processFeatureWithRulesyncFiles({ config, processor, rulesyncFiles });

        totalCount += result.count;
        allPaths.push(...result.paths);
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} permissions files for ${outputRoot}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return { count: totalCount, paths: allPaths, hasDiff };
}
