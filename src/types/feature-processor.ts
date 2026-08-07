import { fileContentIsEmptyPayload, fileContentsEquivalent } from "../utils/content-equivalence.js";
import {
  addTrailingNewline,
  applyFileMode,
  readFileContentOrNull,
  removeFile,
  writeFileContent,
} from "../utils/file.js";
import type { Logger } from "../utils/logger.js";
import type { WriteResult } from "../utils/result.js";
import { AiFile } from "./ai-file.js";
import { RulesyncFile } from "./rulesync-file.js";
import { ToolFile } from "./tool-file.js";
import { ToolTarget } from "./tool-targets.js";

export abstract class FeatureProcessor {
  protected readonly outputRoot: string;
  protected readonly inputRoot: string;
  protected readonly dryRun: boolean;
  protected readonly logger: Logger;

  constructor({
    outputRoot = process.cwd(),
    inputRoot = process.cwd(),
    dryRun = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoot?: string;
    dryRun?: boolean;
    logger: Logger;
  }) {
    this.outputRoot = outputRoot;
    this.inputRoot = inputRoot;
    this.dryRun = dryRun;
    this.logger = logger;
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
      const existingFileContent = await readFileContentOrNull(filePath);

      if (existingFileContent !== null && aiFile.shouldMergeExistingFileContent()) {
        aiFile.setFileContent(existingFileContent);
      }

      const contentWithNewline = addTrailingNewline(aiFile.getFileContent());
      const existingContent = existingFileContent;

      // Never bring a shared, user-managed config file into existence just to
      // hold an empty payload — that is pure `git status` noise for paths
      // rulesync merges into but does not own. An existing file is still
      // rewritten, so user-authored content is never dropped.
      if (
        existingContent === null &&
        aiFile.shouldSkipCreationWhenPayloadEmpty() &&
        fileContentIsEmptyPayload({ filePath, content: contentWithNewline })
      ) {
        continue;
      }

      // Optional call: test doubles and older AiFile shapes may not define it.
      const fileMode = aiFile.getFileMode?.();

      if (
        fileContentsEquivalent({
          filePath,
          expected: contentWithNewline,
          existing: existingContent,
        })
      ) {
        // The content is already right, but the mode may not be: an interrupted
        // run (or a file the user copied in) can leave an executable output
        // without its executable bit, and the write that would have fixed it is
        // the one being skipped here.
        if (fileMode !== undefined && !this.dryRun) {
          await applyFileMode(filePath, fileMode);
        }
        continue;
      }

      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would write: ${filePath}`);
      } else {
        await writeFileContent(filePath, contentWithNewline);
        if (fileMode !== undefined) {
          await applyFileMode(filePath, fileMode);
        }
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
        this.logger.info(`[DRY RUN] Would delete: ${filePath}`);
      } else {
        await removeFile(filePath);
      }
    }

    return orphanFiles.length;
  }
}
