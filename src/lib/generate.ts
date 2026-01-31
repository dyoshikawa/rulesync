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

  const ignoreCount = await generateIgnoreCore({ config });
  const mcpCount = await generateMcpCore({ config });
  const commandsCount = await generateCommandsCore({ config });
  const subagentsCount = await generateSubagentsCore({ config });
  const skillsResult = await generateSkillsCore({ config });
  const hooksCount = await generateHooksCore({ config });
  const rulesCount = await generateRulesCore({ config, skills: skillsResult.skills });

  return {
    rulesCount,
    ignoreCount,
    mcpCount,
    commandsCount,
    subagentsCount,
    skillsCount: skillsResult.count,
    hooksCount,
    skills: skillsResult.skills,
  };
}

async function generateRulesCore(params: {
  config: Config;
  skills?: RulesyncSkill[];
}): Promise<number> {
  const { config, skills } = params;

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

      const rulesyncFiles = await processor.loadRulesyncFiles();
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

async function generateCommandsCore(params: { config: Config }): Promise<number> {
  const { config } = params;

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

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}

async function generateSubagentsCore(params: { config: Config }): Promise<number> {
  const { config } = params;

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

async function generateHooksCore(params: { config: Config }): Promise<number> {
  const { config } = params;

  if (!config.getFeatures().includes("hooks")) {
    return 0;
  }

  let totalCount = 0;

  const toolTargets = intersection(
    config.getTargets(),
    HooksProcessor.getToolTargets({ global: config.getGlobal() }),
  );

  for (const baseDir of config.getBaseDirs()) {
    for (const toolTarget of toolTargets) {
      const processor = new HooksProcessor({
        baseDir,
        toolTarget,
        global: config.getGlobal(),
      });

      if (config.getDelete()) {
        const oldToolFiles = await processor.loadToolFiles({ forDeletion: true });
        await processor.removeAiFiles(oldToolFiles);
      }

      const rulesyncFiles = await processor.loadRulesyncFiles();
      if (rulesyncFiles.length === 0) {
        continue;
      }

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);
      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;
    }
  }

  return totalCount;
}
