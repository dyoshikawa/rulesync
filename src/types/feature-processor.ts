import type { WriteResult } from "../utils/result.js";

import {
  addTrailingNewline,
  readFileContentOrNull,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { logger } from "../utils/logger.js";
import { AiFile } from "./ai-file.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class FeatureProcessor {
  protected readonly baseDir: string;
  protected readonly dryRun: boolean;

  constructor({ baseDir = process.cwd(), dryRun = false }: { baseDir?: string; dryRun?: boolean }) {
    this.baseDir = baseDir;
    this.dryRun = dryRun;
  }

  abstract loadRulesyncFiles(): Promise<RulesyncFile[]>;

  abstract loadToolFiles(params?: { forDeletion?: boolean }): Promise<ToolFile[]>;

  abstract convertRulesyncFilesToToolFiles(rulesyncFiles: RulesyncFile[]): Promise<ToolFile[]>;

  abstract convertToolFilesToRulesyncFiles(toolFiles: ToolFile[]): Promise<RulesyncFile[]>;

  /**
   * Return tool targets that this feature supports.
   */
  static getToolTargets(
    _params: { global?: boolean; includeSimulated?: boolean } = {},
  ): ToolTarget[] {
    throw new Error("Not implemented");
  }

  /**
   * Once converted to rulesync/tool files, write them to the filesystem.
   * Returns the count and paths of files written.
   */
  async writeAiFiles(aiFiles: AiFile[]): Promise<WriteResult> {
    let changedCount = 0;
    const changedPaths: string[] = [];
    for (const aiFile of aiFiles) {
      const filePath = aiFile.getFilePath();
      const contentWithNewline = addTrailingNewline(aiFile.getFileContent());
      const existingContent = await readFileContentOrNull(filePath);

      if (existingContent === contentWithNewline) {
        continue;
      }

      if (this.dryRun) {
        logger.info(`[DRY RUN] Would write: ${filePath}`);
      } else {
        await writeFileContent(filePath, contentWithNewline);
      }
      changedCount++;
      changedPaths.push(aiFile.getRelativePathFromCwd());
    }

    return { count: changedCount, paths: changedPaths };
  }

  async removeAiFiles(aiFiles: AiFile[]): Promise<void> {
    for (const aiFile of aiFiles) {
      await removeFile(aiFile.getFilePath());
    }
  }

  /**
   * Remove orphan files that exist in the tool directory but not in the generated files.
   * This only deletes files that are no longer in the rulesync source, not files that will be overwritten.
   */
  async removeOrphanAiFiles(existingFiles: AiFile[], generatedFiles: AiFile[]): Promise<number> {
    const generatedPaths = new Set(generatedFiles.map((f) => f.getFilePath()));
    const orphanFiles = existingFiles.filter((f) => !generatedPaths.has(f.getFilePath()));

    for (const aiFile of orphanFiles) {
      const filePath = aiFile.getFilePath();
      if (this.dryRun) {
        logger.info(`[DRY RUN] Would delete: ${filePath}`);
      } else {
        await removeFile(filePath);
      }
    }

    return orphanFiles.length;
  }
}
