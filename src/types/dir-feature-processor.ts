import { join, relative, resolve } from "node:path";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  companionFileContentsEquivalent,
  fileContentsEquivalent,
} from "../utils/content-equivalence.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import {
  addTrailingNewline,
  ensureDir,
  pathEscapesRoot,
  readFileBufferOrNull,
  readFileContentOrNull,
  removeDirectory,
  writeFileBuffer,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import type { Logger } from "../utils/logger.js";
import type { WriteResult } from "../utils/result.js";
import { AiDir, AiDirFile } from "./ai-dir.js";
import { RulesyncSourceConsumer } from "./rulesync-source-consumer.js";
import { ToolTarget } from "./tool-targets.js";

/**
 * Whether the directory a candidate reports really is one of the directories
 * inside the root it was enumerated from.
 *
 * Positional rather than delegated: a subclass that overrides
 * {@link AiDir.getDirPath} without keeping {@link AiDir.ownsDirTree} in
 * agreement with it is caught here, since the answer comes from comparing the
 * path against the root instead of from asking the candidate whether its path
 * is its own. Equal paths fail it too — a candidate that reports the root is
 * the shared root, and deleting that takes every sibling in it.
 *
 * It is a backstop, not the guard: the comparison is lexical, so a root that is
 * itself a link into another tree still passes it, and the caller-side
 * `assertWritablePathInsideRoot` — which resolves the real path — is what rules
 * that out. The three values it reads are the candidate's own, so it is a
 * consistency check across them rather than a fact about the filesystem.
 */
function isInsideOwnRoot(aiDir: AiDir): boolean {
  const root = resolve(join(aiDir.getOutputRoot(), aiDir.getRelativeDirPath()));
  const relativeToRoot = relative(root, resolve(aiDir.getDirPath()));
  return relativeToRoot !== "" && !pathEscapesRoot(relativeToRoot);
}

export abstract class DirFeatureProcessor extends RulesyncSourceConsumer {
  protected readonly outputRoot: string;
  /**
   * Ordered, non-empty list of rulesync source-tree directories. Each entry
   * is a source tree itself — the directory that directly contains
   * feature subdirectories (`rules/`, `skills/`, …) and single-file
   * features (`mcp.jsonc`, `hooks.jsonc`, …). Later entries take precedence
   * when two trees supply the same relative path. Defaults to
   * `[join(process.cwd(), ".rulesync")]`.
   *
   * The singular user-facing alias (`inputRoot` in `rulesync.jsonc` / the
   * `--input-root` CLI flag / `GenerateOptions.inputRoot`) is deprecated
   * and collapsed into `[join(inputRoot, ".rulesync")]` before it ever
   * reaches a processor.
   */
  protected readonly inputRoots: readonly [string, ...string[]];
  protected readonly dryRun: boolean;
  protected readonly avoidBlockScalars: boolean;
  protected readonly logger: Logger;
  constructor({
    outputRoot = process.cwd(),
    inputRoots,
    dryRun = false,
    avoidBlockScalars = false,
    logger,
  }: {
    outputRoot?: string;
    inputRoots?: readonly [string, ...string[]] | readonly string[];
    dryRun?: boolean;
    avoidBlockScalars?: boolean;
    logger: Logger;
  }) {
    super();

    this.outputRoot = outputRoot;

    this.inputRoots =
      inputRoots !== undefined && inputRoots.length > 0
        ? [inputRoots[0]!, ...inputRoots.slice(1)]
        : [join(process.cwd(), RULESYNC_RELATIVE_DIR_PATH)];

    this.dryRun = dryRun;
    this.avoidBlockScalars = avoidBlockScalars;
    this.logger = logger;
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
        const content = stringifyFrontmatter(mainFile.body, mainFile.frontmatter, {
          avoidBlockScalars: this.avoidBlockScalars,
        });
        mainFileContent = addTrailingNewline(content);
        const existingContent = await readFileContentOrNull(mainFilePath);
        if (
          !fileContentsEquivalent({
            filePath: mainFilePath,
            expected: mainFileContent,
            existing: existingContent,
          })
        ) {
          dirHasChanges = true;
        }
      }

      // Companion files beside the main file are written byte for byte. Most
      // of them are user assets — images, archives, CRLF fixtures, a file whose
      // missing trailing newline is deliberate — and unlike the main file,
      // whose body and frontmatter rulesync composes, nothing about them is
      // rulesync's to normalize. Sending them through a UTF-8 round-trip with
      // trailing-newline normalization silently rewrote their bytes.
      const otherFiles: AiDirFile[] = aiDir.getOtherFiles();
      for (const file of otherFiles) {
        // Detection only; the write loop below covers every file once the
        // directory is known to have changed.
        if (dirHasChanges) {
          break;
        }
        const filePath = join(dirPath, file.relativeFilePathToDirPath);
        const existingBuffer = await readFileBufferOrNull(filePath);
        if (
          !companionFileContentsEquivalent({
            filePath,
            expected: file.fileBuffer,
            existing: existingBuffer,
            composed: file.composed,
          })
        ) {
          dirHasChanges = true;
        }
      }

      if (!dirHasChanges) {
        continue;
      }

      const relativeDir = aiDir.getRelativePathFromCwd();
      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would create directory: ${stripControlCharacters(dirPath)}`);
        if (mainFile) {
          this.logger.info(
            `[DRY RUN] Would write: ${stripControlCharacters(join(dirPath, mainFile.name))}`,
          );
          changedPaths.push(join(relativeDir, mainFile.name));
        }
        for (const file of otherFiles) {
          this.logger.info(
            `[DRY RUN] Would write: ${stripControlCharacters(join(dirPath, file.relativeFilePathToDirPath))}`,
          );
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
        for (const file of otherFiles) {
          const filePath = join(dirPath, file.relativeFilePathToDirPath);
          await writeFileBuffer(filePath, file.fileBuffer);
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
    const orphanDirs = existingDirs.filter((d) => {
      // A candidate that does not own its directory tree cannot be an orphan of
      // itself: its path is a root it merely flattens into, so deleting it would
      // take every sibling in that root with it (see `AiDir.ownsDirTree`).
      // Checked first, because a tool that flattens says so here and reports
      // the root as its path — an expected shape, not the mismatch below.
      if (!d.ownsDirTree()) {
        this.logger.debug(
          // Quoted by the serializer: the name comes off disk, and while the
          // strip above rules out forging a whole line, an unquoted name like
          // `Deleted directory: /home/you/important` still reads as one.
          `Skipping orphan sweep for ${JSON.stringify(stripControlCharacters(d.getDirName()))}: ` +
            `${stripControlCharacters(d.getDirPath())} is a shared root, not a directory of its own`,
        );
        return false;
      }
      // Checked here rather than trusted from the caller: this method is public
      // on the base class and takes any `AiDir`, so a future caller inherits the
      // recursive deletion without the caller-side guards `SkillsProcessor`
      // applies. A candidate that claims its directory as its own and reports a
      // path that is not in the root it was found in has a contract mismatch,
      // and this is where that stops being a deletion the user cannot undo.
      if (!isInsideOwnRoot(d)) {
        const dirPath = JSON.stringify(stripControlCharacters(d.getDirPath()));
        const root = join(d.getOutputRoot(), d.getRelativeDirPath());
        this.logger.warn(
          resolve(root) === resolve(d.getDirPath())
            ? `Refusing to delete ${dirPath}: it is the root it was found in, not a directory ` +
                `inside that root`
            : `Refusing to delete ${dirPath}: it is not inside ` +
                `${JSON.stringify(stripControlCharacters(root))}, the root it was found in`,
        );
        return false;
      }
      return !generatedPaths.has(d.getDirPath());
    });

    for (const aiDir of orphanDirs) {
      const dirPath = aiDir.getDirPath();
      const loggedPath = stripControlCharacters(dirPath);
      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would delete directory: ${loggedPath}`);
      } else {
        await removeDirectory(dirPath);
        this.logger.info(`Deleted directory: ${loggedPath}`);
      }
    }

    return orphanDirs.length;
  }
}
