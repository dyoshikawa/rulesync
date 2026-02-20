import { join } from "node:path";

import type { WriteResult } from "../utils/result.js";

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
   *
   * Note: This method uses directory-level change detection. If any file within
   * a directory has changed, ALL files in that directory are rewritten. This is
   * an intentional design decision to ensure consistency within directory units.
   */
  async writeAiDirs(aiDirs: AiDir[]): Promise<WriteResult> {
    let changedCount = 0;
    const changedPaths: string[] = [];
    for (const aiDir of aiDirs) {
      const dirPath = aiDir.getDirPath();
      let dirHasChanges = false;

      // Compute content for main file
      const mainFile = aiDir.getMainFile();
      let mainFileContent: string | undefined;
      if (mainFile) {
        const mainFilePath = join(dirPath, mainFile.name);
        const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter);
        mainFileContent = addTrailingNewline(content);
        const existingContent = await readFileContentOrNull(mainFilePath);
        if (existingContent !== mainFileContent) {
          dirHasChanges = true;
        }
      }

      // Compute content for other files
      const otherFiles: AiDirFile[] = aiDir.getOtherFiles();
      const otherFileContents: string[] = [];
      for (const file of otherFiles) {
        const contentWithNewline = addTrailingNewline(file.fileBuffer.toString("utf-8"));
        otherFileContents.push(contentWithNewline);
        if (!dirHasChanges) {
          const filePath = join(dirPath, file.relativeFilePathToDirPath);
          const existingContent = await readFileContentOrNull(filePath);
          if (existingContent !== contentWithNewline) {
            dirHasChanges = true;
          }
        }
      }

      if (!dirHasChanges) {
        continue;
      }

      const relativeDir = aiDir.getRelativePathFromCwd();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would create directory: ${dirPath}`);
        if (mainFile) {
          logger.info(`[DRY RUN] Would write: ${join(dirPath, mainFile.name)}`);
          changedPaths.push(join(relativeDir, mainFile.name));
        }
        for (const file of otherFiles) {
          logger.info(`[DRY RUN] Would write: ${join(dirPath, file.relativeFilePathToDirPath)}`);
          changedPaths.push(join(relativeDir, file.relativeFilePathToDirPath));
        }
      } else {
        // Create directory
        await ensureDir(dirPath);

        // Write main file if exists
        if (mainFile && mainFileContent) {
          const mainFilePath = join(dirPath, mainFile.name);
          await writeFileContent(mainFilePath, mainFileContent);
          changedPaths.push(join(relativeDir, mainFile.name));
        }

        // Write other files
        for (const [i, file] of otherFiles.entries()) {
          const filePath = join(dirPath, file.relativeFilePathToDirPath);
          const content = otherFileContents[i];
          if (content === undefined) {
            throw new Error(
              `Internal error: content for file ${file.relativeFilePathToDirPath} is undefined. ` +
                "This indicates a synchronization issue between otherFiles and otherFileContents arrays.",
            );
          }
          await writeFileContent(filePath, content);
          changedPaths.push(join(relativeDir, file.relativeFilePathToDirPath));
        }
      }
      changedCount++;
    }

    return { count: changedCount, paths: changedPaths };
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
