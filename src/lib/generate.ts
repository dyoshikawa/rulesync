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
import { formatError } from "../utils/error.js";
import { addTrailingNewline, fileExists, readFileContentOrNull } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
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

  if (!config.getFeatures().includes("rules")) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isPreviewMode) {
        const fileDiff = await detectFileDiff(toolFiles);
        if (fileDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
      }
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateIgnoreCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  if (!config.getFeatures().includes("ignore")) {
    return { count: 0, hasDiff: false };
  }

  if (config.getGlobal()) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

  for (const toolTarget of intersection(config.getTargets(), IgnoreProcessor.getToolTargets())) {
    for (const baseDir of config.getBaseDirs()) {
      try {
        const processor = new IgnoreProcessor({
          baseDir: baseDir === process.cwd() ? "." : baseDir,
          toolTarget,
          dryRun: isPreviewMode,
        });

        const rulesyncFiles = await processor.loadRulesyncFiles();
        if (rulesyncFiles.length > 0) {
          const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

          if (isPreviewMode) {
            const fileDiff = await detectFileDiff(toolFiles);
            if (fileDiff) hasDiff = true;
          }

          const writtenCount = await processor.writeAiFiles(toolFiles);
          totalCount += writtenCount;

          if (config.getDelete()) {
            const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

            if (isPreviewMode) {
              const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
              if (orphanDiff) hasDiff = true;
            }

            await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
          }
        } else if (config.getDelete()) {
          // No rulesync files, so all existing tool files are orphans
          const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

          if (isPreviewMode && existingToolFiles.length > 0) {
            hasDiff = true;
          }

          await processor.removeOrphanAiFiles(existingToolFiles, []);
        }
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

  if (!config.getFeatures().includes("mcp")) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isPreviewMode) {
        const fileDiff = await detectFileDiff(toolFiles);
        if (fileDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
      }
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateCommandsCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  if (!config.getFeatures().includes("commands")) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isPreviewMode) {
        const fileDiff = await detectFileDiff(toolFiles);
        if (fileDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
      }
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateSubagentsCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  if (!config.getFeatures().includes("subagents")) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isPreviewMode) {
        const fileDiff = await detectFileDiff(toolFiles);
        if (fileDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
      }
    }
  }

  return { count: totalCount, hasDiff };
}

async function generateSkillsCore(params: {
  config: Config;
}): Promise<{ count: number; skills: RulesyncSkill[]; hasDiff: boolean }> {
  const { config } = params;

  if (!config.getFeatures().includes("skills")) {
    return { count: 0, skills: [], hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const allSkills: RulesyncSkill[] = [];
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncDirs = await processor.loadRulesyncDirs();

      for (const rulesyncDir of rulesyncDirs) {
        if (rulesyncDir instanceof RulesyncSkill) {
          allSkills.push(rulesyncDir);
        }
      }

      const toolDirs = await processor.convertRulesyncDirsToToolDirs(rulesyncDirs);

      if (isPreviewMode) {
        const dirDiff = await detectDirDiff(toolDirs);
        if (dirDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiDirs(toolDirs);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolDirs = await processor.loadToolDirsToDelete();

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanDirDiff(existingToolDirs, toolDirs);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiDirs(existingToolDirs, toolDirs);
      }
    }
  }

  return { count: totalCount, skills: allSkills, hasDiff };
}

async function generateHooksCore(params: {
  config: Config;
}): Promise<{ count: number; hasDiff: boolean }> {
  const { config } = params;

  if (!config.getFeatures().includes("hooks")) {
    return { count: 0, hasDiff: false };
  }

  let totalCount = 0;
  let hasDiff = false;
  const isPreviewMode = config.isPreviewMode();

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
        dryRun: isPreviewMode,
      });

      const rulesyncFiles = await processor.loadRulesyncFiles();
      if (rulesyncFiles.length === 0) {
        if (config.getDelete()) {
          // No rulesync files, so all existing tool files are orphans
          const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

          if (isPreviewMode && existingToolFiles.length > 0) {
            hasDiff = true;
          }

          await processor.removeOrphanAiFiles(existingToolFiles, []);
        }
        continue;
      }

      const toolFiles = await processor.convertRulesyncFilesToToolFiles(rulesyncFiles);

      if (isPreviewMode) {
        const fileDiff = await detectFileDiff(toolFiles);
        if (fileDiff) hasDiff = true;
      }

      const writtenCount = await processor.writeAiFiles(toolFiles);
      totalCount += writtenCount;

      if (config.getDelete()) {
        const existingToolFiles = await processor.loadToolFiles({ forDeletion: true });

        if (isPreviewMode) {
          const orphanDiff = await detectOrphanFileDiff(existingToolFiles, toolFiles);
          if (orphanDiff) hasDiff = true;
        }

        await processor.removeOrphanAiFiles(existingToolFiles, toolFiles);
      }
    }
  }

  return { count: totalCount, hasDiff };
}

/**
 * Detect if any files would have different content than existing files.
 */
async function detectFileDiff(aiFiles: AiFile[]): Promise<boolean> {
  for (const aiFile of aiFiles) {
    const filePath = aiFile.getFilePath();
    const newContent = addTrailingNewline(aiFile.getFileContent());
    const existingContent = await readFileContentOrNull(filePath);
    if (existingContent !== newContent) {
      return true;
    }
  }
  return false;
}

/**
 * Detect if there are orphan files that would be deleted.
 */
async function detectOrphanFileDiff(
  existingFiles: AiFile[],
  generatedFiles: AiFile[],
): Promise<boolean> {
  const generatedPaths = new Set(generatedFiles.map((f) => f.getFilePath()));
  const orphanFiles = existingFiles.filter((f) => !generatedPaths.has(f.getFilePath()));
  return orphanFiles.length > 0;
}

/**
 * Detect if any directories would have different content than existing directories.
 */
async function detectDirDiff(aiDirs: AiDir[]): Promise<boolean> {
  for (const aiDir of aiDirs) {
    const mainFile = aiDir.getMainFile();
    if (mainFile) {
      const mainFilePath = join(aiDir.getDirPath(), mainFile.name);
      const newContent = addTrailingNewline(
        stringifyFrontmatter(mainFile.body, mainFile.frontmatter),
      );
      const existingContent = await readFileContentOrNull(mainFilePath);
      if (existingContent !== newContent) {
        return true;
      }
    }

    for (const file of aiDir.getOtherFiles()) {
      const filePath = join(aiDir.getDirPath(), file.relativeFilePathToDirPath);
      const newContent = addTrailingNewline(file.fileBuffer.toString("utf-8"));
      const existingContent = await readFileContentOrNull(filePath);
      if (existingContent !== newContent) {
        return true;
      }
    }
  }
  return false;
}

/**
 * Detect if there are orphan directories that would be deleted.
 */
async function detectOrphanDirDiff(
  existingDirs: AiDir[],
  generatedDirs: AiDir[],
): Promise<boolean> {
  const generatedPaths = new Set(generatedDirs.map((d) => d.getDirPath()));
  const orphanDirs = existingDirs.filter((d) => !generatedPaths.has(d.getDirPath()));
  return orphanDirs.length > 0;
}
