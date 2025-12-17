import {
  addTrailingNewline,
  fileExists,
  readFileContent,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import { AiFile } from "./ai-file.js";
import type { CompareAiFilesResult, FileComparisonResult } from "./file-comparison.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class FeatureProcessor {
  protected readonly baseDir: string;

  constructor({ baseDir = process.cwd() }: { baseDir?: string }) {
    this.baseDir = baseDir;
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
   * Returns the number of files written.
   */
  async writeAiFiles(aiFiles: AiFile[]): Promise<number> {
    for (const aiFile of aiFiles) {
      const contentWithNewline = addTrailingNewline(aiFile.getFileContent());
      await writeFileContent(aiFile.getFilePath(), contentWithNewline);
    }

    return aiFiles.length;
  }

  async removeAiFiles(aiFiles: AiFile[]): Promise<void> {
    for (const aiFile of aiFiles) {
      await removeFile(aiFile.getFilePath());
    }
  }

  /**
   * Compare generated files with existing files on disk.
   * Returns comparison results without modifying any files.
   */
  async compareAiFiles(aiFiles: AiFile[]): Promise<CompareAiFilesResult> {
    const results: FileComparisonResult[] = [];

    for (const aiFile of aiFiles) {
      const filePath = aiFile.getFilePath();
      const newContent = addTrailingNewline(aiFile.getFileContent());

      if (await fileExists(filePath)) {
        const existingContent = await readFileContent(filePath);
        if (existingContent === newContent) {
          results.push({ filePath, status: "unchanged" });
        } else {
          results.push({ filePath, status: "update" });
        }
      } else {
        results.push({ filePath, status: "create" });
      }
    }

    const outOfSyncCount = results.filter((r) => r.status !== "unchanged").length;
    return { results, outOfSyncCount };
  }
}
