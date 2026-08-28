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
 * Where a candidate's directory sits relative to the root it was enumerated
 * from: `inside` it, `equal` to it, or `outside` it altogether — or
 * `root-outside`, when that root is not even in the directory this run writes
 * to, which says nothing about where the directory sits within it.
 *
 * Positional rather than delegated: a subclass that overrides
 * {@link AiDir.getDirPath} without keeping {@link AiDir.ownsDirTree} in
 * agreement with it is caught here, since the answer comes from comparing the
 * path against the root instead of from asking the candidate whether the path
 * is its own. `equal` is called out separately because a candidate that reports
 * the root is never swept — deleting that takes every sibling in it — but
 * for a tool that flattens into a shared root it is the expected shape rather
 * than a mismatch.
 *
 * It is a backstop, not the guard: the comparison is lexical, so a root that is
 * itself a link into another tree still passes it, and the caller-side
 * `assertWritablePathInsideRoot` — which resolves the real path — is what rules
 * that out.
 */
function locateInOwnRoot(params: { aiDir: AiDir; dirPath: string; outputRoot: string }): {
  verdict: "inside" | "equal" | "outside" | "root-outside";
  root: string;
} {
  const { aiDir, dirPath, outputRoot } = params;
  const root = join(aiDir.getOutputRoot(), aiDir.getRelativeDirPath());
  // The candidate's own root has to sit in the processor's output root as well.
  // Both halves of it are values the candidate carries, and a `relativeDirPath`
  // that climbs out would otherwise make everything below it look contained.
  if (pathEscapesRoot(relative(resolve(outputRoot), resolve(root)))) {
    return { verdict: "root-outside", root };
  }
  // One `relative()` decides both questions, so the equal case cannot be
  // classified one way here and the other way in the message: on Windows the
  // comparison ignores case, and a direct string equality test would not.
  const relativeToRoot = relative(resolve(root), resolve(dirPath));
  if (relativeToRoot === "") {
    return { verdict: "equal", root };
  }
  return { verdict: pathEscapesRoot(relativeToRoot) ? "outside" : "inside", root };
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

  /**
   * Remove orphan directories that exist in the tool directory but not in the generated directories.
   * This only deletes directories that are no longer in the rulesync source, not directories that will be overwritten.
   */
  async removeOrphanAiDirs(existingDirs: AiDir[], generatedDirs: AiDir[]): Promise<number> {
    const generatedPaths = new Set(generatedDirs.map((d) => d.getDirPath()));
    // A set, so two candidates that report the same directory delete it once
    // and are counted once.
    const orphanPaths = new Set<string>();
    const quotedOutputRoot = JSON.stringify(stripControlCharacters(this.outputRoot));

    for (const aiDir of existingDirs) {
      // Read once, and check and delete that one value: `getDirPath()` is a
      // method a subclass supplies, so calling it again could answer
      // differently and delete something the checks below never saw.
      const dirPath = aiDir.getDirPath();
      const { verdict, root } = locateInOwnRoot({ aiDir, dirPath, outputRoot: this.outputRoot });
      // Quoted by the serializer: the last segment of `dirPath` is a name that
      // came off disk, and while the strip rules out forging a whole line, an
      // unquoted path like `Deleted directory: /home/you/important` still reads
      // as one. The root is quoted with it so one line reads consistently.
      const quotedDirPath = JSON.stringify(stripControlCharacters(dirPath));
      const quotedRoot = JSON.stringify(stripControlCharacters(root));

      // Reported before anything about the directory's position, because a root
      // that is not in the directory this run writes to makes that position
      // meaningless: the directory can sit squarely inside a root that is
      // itself somewhere else entirely.
      if (verdict === "root-outside") {
        this.logger.warn(
          `Refusing to delete ${quotedDirPath}: the root ${quotedRoot} it was found in is not ` +
            `inside ${quotedOutputRoot}, the directory this run writes to`,
        );
        continue;
      }

      if (!aiDir.ownsDirTree()) {
        // False for two different shapes. A tool that flattens into a shared
        // root reports that root as its path: expected, and quiet, since the
        // root is never swept anyway — deleting it takes every sibling in it.
        // Anything else is a `getDirPath()` override that was not kept in
        // agreement with `ownsDirTree()`, and calling that a shared root would
        // be untrue, so it is reported rather than passed over in silence.
        if (verdict === "equal") {
          this.logger.debug(
            `Skipping orphan sweep for ` +
              `${JSON.stringify(stripControlCharacters(aiDir.getDirName()))}: ` +
              `${quotedDirPath} is a shared root, not a directory of its own`,
          );
        } else {
          this.logger.warn(
            `Refusing to delete ${quotedDirPath}: it does not own that directory, and it is not ` +
              `the shared root ${quotedRoot} it was found in either`,
          );
        }
        continue;
      }

      // Checked here rather than trusted from the caller: this method is public
      // on the base class and takes any `AiDir`, so a future caller inherits the
      // recursive deletion without the caller-side guards `SkillsProcessor`
      // applies. A candidate that claims its directory as its own and reports a
      // path that is not in the root it was found in has a contract mismatch,
      // and this is where that stops being a deletion the user cannot undo.
      if (verdict !== "inside") {
        this.logger.warn(
          verdict === "equal"
            ? `Refusing to delete ${quotedDirPath}: it is the root it was found in, not a ` +
                `directory inside that root`
            : `Refusing to delete ${quotedDirPath}: it is not inside ${quotedRoot}, the root it ` +
                `was found in`,
        );
        continue;
      }

      if (!generatedPaths.has(dirPath)) {
        orphanPaths.add(dirPath);
      }
    }

    for (const dirPath of orphanPaths) {
      const loggedPath = JSON.stringify(stripControlCharacters(dirPath));
      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would delete directory: ${loggedPath}`);
      } else {
        await removeDirectory(dirPath);
        this.logger.info(`Deleted directory: ${loggedPath}`);
      }
    }

    return orphanPaths.size;
  }
}
