import { intersection } from "es-toolkit";
import { join } from "node:path";

import { Config } from "../config/config.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { HooksProcessor } from "../features/hooks/hooks-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
import { AiDir } from "../types/ai-dir.js";
import { AiFile } from "../types/ai-file.js";
import { DirFeatureProcessor } from "../types/dir-feature-processor.js";
import { FeatureProcessor } from "../types/feature-processor.js";
import { formatError } from "../utils/error.js";
import { fileExists } from "../utils/file.js";
import { logger } from "../utils/logger.js";

export type GenerateResult = {
  rulesCount: number;
  ignoreCount: number;
  mcpCount: number;
  commandsCount: number;
  subagentsCount: number;
  skillsCount: number;
  hooksCount: number;
  skills: RulesyncSkill[];
  hasDiff: boolean;
};

async function processFeatureGeneration<T extends AiFile>(params: {
  config: Config;
  processor: FeatureProcessor;
  toolFiles: T[];
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config, processor, toolFiles } = params;

  let totalCount = 0;
  let hasDiff = false;

  const writtenCount = await processor.writeAiFiles(toolFiles);
  totalCount += writtenCount;
  if (writtenCount > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });
    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, hasDiff };
}

async function processDirFeatureGeneration(params: {
  config: Config;
  processor: DirFeatureProcessor;
  toolDirs: AiDir[];
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config, processor, toolDirs } = params;

  let totalCount = 0;
  let hasDiff = false;

  const writtenCount = await processor.writeAiDirs(toolDirs);
  totalCount += writtenCount;
  if (writtenCount > 0) hasDiff = true;

  if (config.getDelete()) {
    const existingToolDirs = await processor.loadToolDirsToDelete();
    const orphanCount = await processor.removeOrphanAiDirs(existingToolDirs, toolDirs);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, hasDiff };
}

// Handle special case for empty rulesync files
async function processEmptyFeatureGeneration(params: {
  config: Config;
  processor: FeatureProcessor;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config, processor } = params;

  const totalCount = 0;
  let hasDiff = false;

  if (config.getDelete()) {
    const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });
    const orphanCount = await processor.removeOrphanAiFiles(existingToolFiles, []);
    if (orphanCount > 0) hasDiff = true;
  }

  return { count: totalCount, hasDiff };
}

/**
 * Check if .rulesync directory exists.
 */
export async function checkRulesyncDirExists(params: { baseDir: string }): Promise<boolean> {
  return fileExists(join(params.baseDir, RULESYNC_RELATIVE_DIR_PATH));
}

/**
 * Generate configuration files for AI tools.
 * @throws Error if generation fails
 */
export async function generate(params: { config: Config }): Promise<GenerateResult> {
  const { config } = params;

  const ignoreResult = await generateIgnoreCore({ config });
  const mcpResult = await generateMcpCore({ config });
  const commandsResult = await generateCommandsCore({ config });
  const subagentsResult = await generateSubagentsCore({ config });
  const skillsResult = await generateSkillsCore({ config });
  const hooksResult = await generateHooksCore({ config });
  const rulesResult = await generateRulesCore({ config, skills: skillsResult.skills });

  const hasDiff =
    ignoreResult.hasDiff ||
    mcpResult.hasDiff ||
    commandsResult.hasDiff ||
    subagentsResult.hasDiff ||
    skillsResult.hasDiff ||
    hooksResult.hasDiff ||
    rulesResult.hasDiff;

  return {
    rulesCount: rulesResult.count,
    ignoreCount: ignoreResult.count,
    mcpCount: mcpResult.count,
    commandsCount: commandsResult.count,
    subagentsCount: subagentsResult.count,
    skillsCount: skillsResult.count,
    hooksCount: hooksResult.count,
    skills: skillsResult.skills,
    hasDiff,
  };
}

async function generateRulesCore(params: {
  config: Config;
  skills?: RulesyncSkill[];
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config, skills } = params;

  let totalCount = 0;
  let hasDiff = false;

  const toolTargets = intersection(
    config.getTargets(),
    RulesProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if rules feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("rules")) {
        continue;
      }

      const processor = new RulesProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills: skills,
        dryRun: config.isPreviewMode(),
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles,
      });

      totalCount += result.count;
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateIgnoreCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  if (config.getGlobal()) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    // Check if ignore feature is enabled for this specific target
    if (!config.getFeatures(toolTarget).includes("ignore")) {
      continue;
    }

    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
          dryRun: config.isPreviewMode(),
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        let result;

        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
          result = await processFeatureGeneration({
            config,
            processor,
            toolFiles,
          });
        } else {
          result = await processEmptyFeatureGeneration({
            config,
            processor,
          });
        }

        totalCount += result.count;
        if (result.hasDiff) hasDiff = true;
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${baseDir}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateMcpCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  let totalCount = 0;
  let hasDiff = false;

  const toolTargets = intersection(
    config.getTargets(),
    McpProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if mcp feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("mcp")) {
        continue;
      }

      const processor = new McpProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        modularMcp: config.getModularMcp(),
        dryRun: config.isPreviewMode(),
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles,
      });

      totalCount += result.count;
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateCommandsCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  let totalCount = 0;
  let hasDiff = false;

  const toolTargets = intersection(
    config.getTargets(),
    CommandsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateCommands(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if commands feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("commands")) {
        continue;
      }

      const processor = new CommandsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles,
      });

      totalCount += result.count;
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateSubagentsCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  let totalCount = 0;
  let hasDiff = false;

  const toolTargets = intersection(
    config.getTargets(),
    SubagentsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSubagents(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if subagents feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("subagents")) {
        continue;
      }

      const processor = new SubagentsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      const result = await processFeatureGeneration({
        config,
        processor,
        toolFiles,
      });

      totalCount += result.count;
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateSkillsCore(params: {
  config: Config;
}): Promise<{ count: number; skills: RulesyncSkill[]; hasDiff: boolean }> {
  const { config } = params;

  let totalCount = 0;
  let hasDiff = false;
  const allSkills: RulesyncSkill[] = [];

  const toolTargets = intersection(
    config.getTargets(),
    SkillsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSkills(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if skills feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("skills")) {
        continue;
      }

      const processor = new SkillsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
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
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, skills: allSkills, hasDiff };
}

async function generateHooksCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  let totalCount = 0;
  let hasDiff = false;

  const toolTargets = intersection(
    config.getTargets(),
    HooksProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      // Check if hooks feature is enabled for this specific target
      if (!config.getFeatures(toolTarget).includes("hooks")) {
        continue;
      }

      const processor = new HooksProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
        dryRun: config.isPreviewMode(),
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      let result;

      if (rulesyncFiles.length === 0) {
        result = await processEmptyFeatureGeneration({
          config,
          processor,
        });
      } else {
        const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
        result = await processFeatureGeneration({
          config,
          processor,
          toolFiles,
        });
      }

      totalCount += result.count;
      if (result.hasDiff) hasDiff = true;
    }
  }

  return { count: totalCount, hasDiff };
}
