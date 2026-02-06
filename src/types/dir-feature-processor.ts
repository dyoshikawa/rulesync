import { join } from "node:path";

import {
  addTrailingNewline,
  ensureDir,
  readFileContentOrNull,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { logger } from "../utils/logger.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class DirFeatureProcessor {
  protected readonly baseDir: string;
  protected readonly dryRun: boolean;

  constructor({ baseDir = process.cwd(), dryRun = false }: { baseDir?: string; dryRun?: boolean }) {
    this.baseDir = baseDir;
    this.dryRun = dryRun;
  }

  abstract loadRulesyncDirs(): Promise<AiDir[]>;

  abstract loadToolDirs(): Promise<AiDir[]>;

  abstract loadToolDirsToDelete(): Promise<AiDir[]>;

  abstract convertRulesyncDirsToToolDirs(rulesyncDirs: AiDir[]): Promise<AiDir[]>;

  abstract convertToolDirsToRulesyncDirs(toolDirs: AiDir[]): Promise<AiDir[]>;

  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(
    _params: { global?: boolean; includeSimulated?: boolean } = {},
  ): ToolTarget[] {
    throw new Error("Not implemented");
  }

  /**
   * Once converted to rulesync/tool dirs, write them to the filesystem.
   * Returns the number of directories written.
   */
  async writeAiDirs(aiDirs: AiDir[]): Promise<number> {
    let changedCount = 0;
    for (const aiDir of aiDirs) {
      const dirPath = aiDir.getDirPath();
      let dirHasChanges = false;

      // Check main file for diff
      const mainFile = aiDir.getMainFile();
      if (mainFile) {
        const mainFilePath = join(dirPath, mainFile.name);
        const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter);
        const contentWithNewline = addTrailingNewline(content);
        const existingContent = await readFileContentOrNull(mainFilePath);
        if (existingContent !== contentWithNewline) {
          dirHasChanges = true;
        }
      }

      // Check other files for diff
      const otherFiles: AiDirFile[] = aiDir.getOtherFiles();
      for (const file of otherFiles) {
        const filePath = join(dirPath, file.relativeFilePathToDirPath);
        const contentWithNewline = addTrailingNewline(file.fileBuffer.toString("utf-8"));
        const existingContent = await readFileContentOrNull(filePath);
        if (existingContent !== contentWithNewline) {
          dirHasChanges = true;
        }
      }

      if (!dirHasChanges) {
        continue;
      }

      if (this.dryRun) {
        logger.info(`[DRY RUN] Would create directory: ${dirPath}`);
        if (mainFile) {
          logger.info(`[DRY RUN] Would write: ${join(dirPath, mainFile.name)}`);
        }
        for (const file of otherFiles) {
          logger.info(`[DRY RUN] Would write: ${join(dirPath, file.relativeFilePathToDirPath)}`);
        }
      } else {
        // Create directory
        await ensureDir(dirPath);

        // Write main file if exists
        if (mainFile) {
          const mainFilePath = join(dirPath, mainFile.name);
          const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter);
          const contentWithNewline = addTrailingNewline(content);
          await writeFileContent(mainFilePath, contentWithNewline);
        }

        // Write other files
        for (const file of otherFiles) {
          const filePath = join(dirPath, file.relativeFilePathToDirPath);
          const contentWithNewline = addTrailingNewline(file.fileBuffer.toString("utf-8"));
          await writeFileContent(filePath, contentWithNewline);
        }
      }
      changedCount++;
    }

    return changedCount;
  }

  async removeAiDirs(aiDirs: AiDir[]): Promise<void> {
    for (const aiDir of aiDirs) {
      await removeDirectory(aiDir.getDirPath());
    }
  }

  /**
   * Remove orphan directories that exist in the tool directory but not in the generated directories.
   * This only deletes directories that are no longer in the rulesync source, not directories that will be overwritten.
   */
  async removeOrphanAiDirs(existingDirs: AiDir[], generatedDirs: AiDir[]): Promise<number> {
    const generatedPaths = new Set(generatedDirs.map((d) => d.getDirPath()));
    const orphanDirs = existingDirs.filter((d) => !generatedPaths.has(d.getDirPath()));

    for (const aiDir of orphanDirs) {
      const dirPath = aiDir.getDirPath();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete directory: ${dirPath}`);
      } else {
        await removeDirectory(dirPath);
      }
    }

    return orphanDirs.length;
  }
}
