import { join } from "node:path";
import {
  addTrailingNewline,
  directoryExists,
  ensureDir,
  fileExists,
  readFileContent,
  removeDirectory,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import type { CompareAiFilesResult, FileComparisonResult } from "./file-comparison.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class DirFeatureProcessor {
  protected readonly baseDir: string;

  constructor({ baseDir = process.cwd() }: { baseDir?: string }) {
    this.baseDir = baseDir;
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
    for (const aiDir of aiDirs) {
      const dirPath = aiDir.getDirPath();

      // Create directory
      await ensureDir(dirPath);

      // Write main file if exists
      const mainFile = aiDir.getMainFile();
      if (mainFile) {
        const mainFilePath = join(dirPath, mainFile.name);
        const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter);
        const contentWithNewline = addTrailingNewline(content);
        await writeFileContent(mainFilePath, contentWithNewline);
      }

      // Write other files
      const otherFiles: AiDirFile[] = aiDir.getOtherFiles();
      for (const file of otherFiles) {
        const filePath = join(dirPath, file.relativeFilePathToDirPath);
        const contentWithNewline = addTrailingNewline(file.fileBuffer.toString("utf-8"));
        await writeFileContent(filePath, contentWithNewline);
      }
    }

    return aiDirs.length;
  }

  async removeAiDirs(aiDirs: AiDir[]): Promise<void> {
    for (const aiDir of aiDirs) {
      await removeDirectory(aiDir.getDirPath());
    }
  }

  /**
   * Compare generated directories with existing directories on disk.
   * Returns comparison results without modifying any files.
   */
  async compareAiDirs(aiDirs: AiDir[]): Promise<CompareAiFilesResult> {
    const results: FileComparisonResult[] = [];

    for (const aiDir of aiDirs) {
      const dirPath = aiDir.getDirPath();

      // Check if directory exists
      if (!(await directoryExists(dirPath))) {
        results.push({ filePath: dirPath, status: "create" });
        continue;
      }

      // Compare main file if exists
      const mainFile = aiDir.getMainFile();
      if (mainFile) {
        const mainFilePath = join(dirPath, mainFile.name);
        const newContent = addTrailingNewline(
          stringifyFrontmatter(mainFile.body, mainFile.frontmatter),
        );

        if (await fileExists(mainFilePath)) {
          const existingContent = await readFileContent(mainFilePath);
          if (existingContent !== newContent) {
            results.push({ filePath: dirPath, status: "update" });
            continue;
          }
        } else {
          results.push({ filePath: dirPath, status: "update" });
          continue;
        }
      }

      // Compare other files
      const otherFiles: AiDirFile[] = aiDir.getOtherFiles();
      let hasChanges = false;
      for (const file of otherFiles) {
        const filePath = join(dirPath, file.relativeFilePathToDirPath);
        const newContent = addTrailingNewline(file.fileBuffer.toString("utf-8"));

        if (await fileExists(filePath)) {
          const existingContent = await readFileContent(filePath);
          if (existingContent !== newContent) {
            hasChanges = true;
            break;
          }
        } else {
          hasChanges = true;
          break;
        }
      }

      if (hasChanges) {
        results.push({ filePath: dirPath, status: "update" });
      } else {
        results.push({ filePath: dirPath, status: "unchanged" });
      }
    }

    const outOfSyncCount = results.filter((r) => r.status !== "unchanged").length;
    return { results, outOfSyncCount };
  }
}
