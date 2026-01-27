import { intersection } from "es-toolkit";
import { join } from "node:path";

import { Config } from "../config/config.js";
import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import { CommandsProcessor } from "../features/commands/commands-processor.js";
import { IgnoreProcessor } from "../features/ignore/ignore-processor.js";
import { McpProcessor } from "../features/mcp/mcp-processor.js";
import {
  hasEnabledPlugins,
  mergedFilesToRulesyncRules,
  MergedPluginContent,
  processPlugins,
} from "../features/plugins/plugin-processor.js";
import { RulesProcessor } from "../features/rules/rules-processor.js";
import { RulesyncSkill } from "../features/skills/rulesync-skill.js";
import { SkillsProcessor } from "../features/skills/skills-processor.js";
import { SubagentsProcessor } from "../features/subagents/subagents-processor.js";
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
  skills: RulesyncSkill[];
};

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

  // Process plugins if any are enabled
  let pluginContent: MergedPluginContent | null = null;
  const plugins = config.getPlugins();

  if (hasEnabledPlugins(plugins)) {
    logger.info("Processing plugins...");
    // Process plugins for each baseDir
    for (const baseDir of config.getBaseDirs()) {
      pluginContent = await processPlugins({
        plugins,
        baseDir,
        mergeStrategy: config.getPluginMergeStrategy(),
      });

      // Log any plugin resolution errors
      for (const error of pluginContent.resolutionErrors) {
        logger.error(`Plugin error (${error.identifier}): ${error.error}`);
      }

      // Log merge errors
      const allMergeErrors = [
        ...pluginContent.rules.errors,
        ...pluginContent.commands.errors,
        ...pluginContent.subagents.errors,
      ];
      for (const error of allMergeErrors) {
        logger.error(`Plugin merge error: ${error}`);
      }
    }
  }

  const ignoreCount = await generateIgnoreCore({ config });
  const mcpCount = await generateMcpCore({ config });
  const commandsCount = await generateCommandsCore({ config, pluginContent });
  const subagentsCount = await generateSubagentsCore({ config, pluginContent });
  const skillsResult = await generateSkillsCore({ config });
  const rulesCount = await generateRulesCore({
    config,
    skills: skillsResult.skills,
    pluginContent,
  });

  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount: skillsResult.count,
    skills: skillsResult.skills,
  };
}

async function generateRulesCore(params: {
  config: Config;
  skills?: RulesyncSkill[];
  pluginContent?: MergedPluginContent | null;
}): Promise<number> {
  const { config, skills, pluginContent } = params;

  if (!config.getFeatures().includes("rules")) {
    return 0;
  }

  let totalCount = 0;

  const toolTargets = intersection(
    config.getTargets(),
    RulesProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new RulesProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        simulateCommands: config.getSimulateCommands(),
        simulateSubagents: config.getSimulateSubagents(),
        simulateSkills: config.getSimulateSkills(),
        skills: skills,
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      // Use merged plugin content if available, otherwise load from local .rulesync/
      let rulesyncFiles;
      if (pluginContent && pluginContent.rules.files.length > 0) {
        rulesyncFiles = await mergedFilesToRulesyncRules({
          mergeResult: pluginContent.rules,
          baseDir,
        });
        logger.debug(`Using ${rulesyncFiles.length} rule files (merged from local and plugins)`);
      } else {
        rulesyncFiles = await processor.loadRulesyncFiles();
      }

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}

async function generateIgnoreCore(params: { config: Config }): Promise<number> {
  const { config } = params;

  if (!config.getFeatures().includes("ignore")) {
    return 0;
  }

  if (config.getGlobal()) {
    return 0;
  }

  let totalCount = 0;

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
        });

        if (config.getDelete()) {
          const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
          await processor.removeAiFiles(oldToolFiles);
        }

        const rulesyncFiles = await processor.loadRulesyncFiles();
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
          const writtenCount = await processor.writeAiFiles(toolFiles);
          totalCount += writtenCount;
        }
      } catch (error) {
        logger.warn(
          `Failed to generate ${toolTarget} ignore files for ${baseDir}: ${formatError(error)}`,
        );
        continue;
      }
    }
  }

  return totalCount;
}

async function generateMcpCore(params: { config: Config }): Promise<number> {
  const { config } = params;

  if (!config.getFeatures().includes("mcp")) {
    return 0;
  }

  let totalCount = 0;

  const toolTargets = intersection(
    config.getTargets(),
    McpProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new McpProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
        modularMcp: config.getModularMcp(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}

async function generateCommandsCore(params: {
  config: Config;
  pluginContent?: MergedPluginContent | null;
}): Promise<number> {
  const { config, pluginContent: _pluginContent } = params;

  if (!config.getFeatures().includes("commands")) {
    return 0;
  }

  let totalCount = 0;

  const toolTargets = intersection(
    config.getTargets(),
    CommandsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateCommands(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new CommandsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      // TODO: Integrate plugin commands in future
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}

async function generateSubagentsCore(params: {
  config: Config;
  pluginContent?: MergedPluginContent | null;
}): Promise<number> {
  const { config, pluginContent: _pluginContent } = params;

  if (!config.getFeatures().includes("subagents")) {
    return 0;
  }

  let totalCount = 0;

  const toolTargets = intersection(
    config.getTargets(),
    SubagentsProcessor.getToolTargets({
      global: config.getGlobal(),
      includeSimulated: config.getSimulateSubagents(),
    }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new SubagentsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      // TODO: Integrate plugin subagents in future
      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}

async function generateSkillsCore(params: {
  config: Config;
}): Promise<{ count: number; skills: RulesyncSkill[] }> {
  const { config } = params;

  if (!config.getFeatures().includes("skills")) {
    return { count: 0, skills: [] };
  }

  let totalCount = 0;
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
      const processor = new SkillsProcessor({
        baseDir: baseDir,
        toolTarget: toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolDirs = await processor.loadToolDirsToDelete();
        await processor.removeAiDirs(oldToolDirs);
      }

      const rulesyncDirs = await processor.loadRulesyncDirs();

      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);
      const writtenCount = await processor.writeAiDirs(toolDirs);
      totalCount += writtenCount;
    }
  }

  return { count: totalCount, skills: allSkills };
}
