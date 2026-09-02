import { dirname, join, relative, resolve } from "node:path";

import { RULESYNC_RELATIVE_DIR_PATH } from "../constants/rulesync-paths.js";
import {
  companionFileContentsEquivalent,
  fileContentsEquivalent,
} from "../utils/content-equivalence.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import {
  addTrailingNewline,
  ensureDir,
  listFilePathsRecursively,
  pathEscapesRoot,
  readFileBufferOrNull,
  readFileContentOrNull,
  removeDirectory,
  removeFile,
  toPosixPath,
  writeFileBuffer,
  writeFileContent,
} from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import type { Logger } from "../utils/logger.js";
import type { WriteResult } from "../utils/result.js";
import { hasIncompleteCarriedFiles } from "../utils/warned-once.js";
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

  /**
   * The flat files to consider for deletion: the `<name>.md` a tool that
   * flattens into a shared root writes for each entry, instead of a directory
   * of its own (`TaktSkill`). Every candidate returned must report that file
   * from {@link AiDir.getFlatFilePath}.
   *
   * A directory feature whose tools all own their directories has none, which
   * is why the default is empty: the directory half of the sweep already covers
   * everything such a tool writes.
   */
  async loadToolFlatFilesToDelete(): Promise<AiDir[]> {
    return [];
  }

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

    return await this.deleteOrphanPaths({ paths: orphanPaths, kind: "directory" });
  }

  /**
   * Remove the files left inside a directory this run still generates, but
   * which the run no longer writes.
   *
   * The directory sweep above cannot see them: it removes a directory that no
   * longer corresponds to any generated entry, and never looks inside one that
   * does. So deleting a companion file from a source directory that is
   * otherwise kept left the generated copy in place — and, because change
   * detection compares only the files the run will write, the run reported
   * itself up to date while an agent went on reading the stale file. The same
   * gap left any file that was never rulesync's sitting inside a directory the
   * user now believes rulesync owns.
   *
   * Only a directory that owns its whole tree is swept, and only when this run
   * generated it. That is the same claim the directory sweep already acts on,
   * one level down: a directory whose entry disappears is deleted outright,
   * companion files and all, so a file inside one whose entry is still here and
   * which no source produces is stale by exactly the same reasoning.
   *
   * Two kinds of file are left alone, because rulesync could not have written
   * them and so cannot be looking at its own stale output:
   *
   * - **Hidden entries**, which the loader that carries companion files refuses
   *   on the way in. A `.gitkeep` under a skill directory is the user's.
   * - **Symbolic links**, which the writer never creates. The walk neither
   *   follows nor reports them, so a link is never removed and never resolved
   *   into a deletion somewhere outside the tree.
   *
   * Nothing is swept at all by a run that could not read its sources in full.
   * `AiDir` drops a companion file it cannot open, and stops short of a subtree
   * it is denied or that runs past one of its bounds -- warning each time, but
   * carrying on, because a skill that is short one file is still worth writing.
   * The output copy of such a file is then indistinguishable here from a file
   * whose source was deleted, and the wrong guess deletes something the next
   * readable run would put straight back. So a shortfall anywhere in the run
   * calls the whole sweep off: it is the sweeps that are optional, not the
   * files.
   *
   * @param isClaimed - Whether some other target or feature in this run wrote
   *   this exact path. A shared output root -- `.agents/skills/`, written by
   *   several targets at once -- is a directory whose entry here lists only
   *   *this* target's files, so without the run's own record a sibling's fresh
   *   output reads as an orphan. Asked per path rather than per tree: a tree
   *   claim covers the directory this sweep is looking inside of, and would
   *   answer yes to every file in it.
   */
  async removeOrphanFilesInAiDirs({
    generatedDirs,
    isClaimed,
  }: {
    generatedDirs: AiDir[];
    isClaimed: (path: string) => boolean;
  }): Promise<number> {
    if (hasIncompleteCarriedFiles()) {
      this.logger.debug(
        "Not sweeping the files inside generated directories: this run could not read every " +
          "file its sources carry, so a file it did not write may still be one it wants",
      );
      return 0;
    }

    const orphanPaths = new Set<string>();
    const quotedOutputRoot = JSON.stringify(stripControlCharacters(this.outputRoot));

    for (const aiDir of generatedDirs) {
      // Read once and act on that one value, as the sweeps around this one do:
      // `getDirPath()` is a method a subclass supplies, and a second call could
      // answer differently from the one the checks below ruled on.
      const dirPath = aiDir.getDirPath();
      if (!aiDir.ownsDirTree()) {
        // A tool that flattens into a shared root reports that root here. Its
        // files are swept by `removeOrphanFlatFiles`, which knows to sweep only
        // the ones it can name; everything else in a shared root belongs to
        // somebody else.
        continue;
      }

      const { verdict, root } = locateInOwnRoot({ aiDir, dirPath, outputRoot: this.outputRoot });
      const quotedDirPath = JSON.stringify(stripControlCharacters(dirPath));
      const quotedRoot = JSON.stringify(stripControlCharacters(root));

      if (verdict === "root-outside") {
        this.logger.warn(
          `Refusing to sweep ${quotedDirPath}: the root ${quotedRoot} it was found in is not ` +
            `inside ${quotedOutputRoot}, the directory this run writes to`,
        );
        continue;
      }
      if (verdict !== "inside") {
        this.logger.warn(
          `Refusing to sweep ${quotedDirPath}: it is not a directory inside ${quotedRoot}, the ` +
            `root it was found in`,
        );
        continue;
      }

      const generatedNames = new Set<string>();
      const mainFile = aiDir.getMainFile();
      if (mainFile) {
        generatedNames.add(toPosixPath(mainFile.name));
      }
      for (const file of aiDir.getOtherFiles()) {
        generatedNames.add(toPosixPath(file.relativeFilePathToDirPath));
      }
      // Folded alongside the exact names for the same reason the flat-file
      // sweep folds its paths: on a case-insensitive filesystem a companion
      // renamed from `Ref.md` to `ref.md` is written through the directory
      // entry that is still spelled `Ref.md`, and the name read back would
      // otherwise match nothing this run wrote and be swept as an orphan.
      const generatedNamesFolded = new Set([...generatedNames].map((name) => name.toLowerCase()));

      const existingNames = await listFilePathsRecursively(dirPath, {
        followSymbolicLinks: false,
        includeHidden: false,
      });
      for (const existingName of existingNames) {
        const posixName = toPosixPath(existingName);
        if (generatedNames.has(posixName) || generatedNamesFolded.has(posixName.toLowerCase())) {
          continue;
        }
        const filePath = join(dirPath, existingName);
        if (isClaimed(filePath)) {
          continue;
        }
        orphanPaths.add(filePath);
      }
    }

    return await this.deleteOrphanPaths({ paths: orphanPaths, kind: "file" });
  }

  /**
   * Delete the paths the sweeps decided on, or report what a real run would
   * have deleted. Shared by both halves so the dry-run wording, the quoting of
   * a name that came off disk, and the count they return stay one behavior
   * rather than two that drift.
   */
  private async deleteOrphanPaths({
    paths,
    kind,
  }: {
    paths: Set<string>;
    kind: "directory" | "file";
  }): Promise<number> {
    for (const targetPath of paths) {
      const loggedPath = JSON.stringify(stripControlCharacters(targetPath));
      if (this.dryRun) {
        this.logger.info(`[DRY RUN] Would delete ${kind}: ${loggedPath}`);
      } else {
        await (kind === "directory" ? removeDirectory(targetPath) : removeFile(targetPath));
        this.logger.info(`Deleted ${kind}: ${loggedPath}`);
      }
    }

    return paths.size;
  }

  /**
   * Remove the orphan files of a tool that flattens into a shared root: the
   * `<name>.md` files under that root which no source in this run produces.
   *
   * The directory sweep above cannot see them. Such a tool owns no directory of
   * its own — the root it writes into is shared, and deleting that takes every
   * sibling in it, hand-authored files included — so the file each entry writes
   * is the only thing there is to sweep. Anything else under the root is left
   * alone: a subdirectory, and any file the enumeration did not hand over.
   *
   * A root this run wrote no file into is left alone entirely. Every file in
   * it would count as an orphan there, and a root with no source behind it is
   * not one whose contents have all gone orphan — it is one rulesync does not
   * manage.
   */
  async removeOrphanFlatFiles({
    existingFlatFiles,
    generatedDirs,
  }: {
    existingFlatFiles: AiDir[];
    generatedDirs: AiDir[];
  }): Promise<number> {
    // Everything this run wrote into a shared root, not just the file that
    // stands for each entry: a takt skill's companion files land beside it,
    // directly under the same root, and one of those is exactly as much a file
    // of this run as the main file is.
    const generatedPaths = new Set<string>();
    // The roots this run actually wrote a file into. A root it wrote nothing
    // into is a root it does not manage, and every file in it would be an
    // orphan — which is the difference between "one skill was renamed" and
    // "there is no source here at all", and the whole of a shared root is far
    // too much to delete on the strength of the second.
    const generatedRoots = new Set<string>();
    for (const generatedDir of generatedDirs) {
      const flatFilePath = generatedDir.getFlatFilePath();
      if (flatFilePath === undefined) {
        continue;
      }
      const generatedDirPath = generatedDir.getDirPath();
      generatedRoots.add(generatedDirPath);
      generatedPaths.add(flatFilePath);
      for (const file of generatedDir.getOtherFiles()) {
        generatedPaths.add(join(generatedDirPath, file.relativeFilePathToDirPath));
      }
    }
    // Case-folded alongside the exact paths, for a case-insensitive filesystem
    // only: there, a source renamed from `Foo` to `foo` writes through the
    // directory entry that is still spelled `Foo.md`, so the name the
    // enumeration reads back never matches the path this run wrote and the
    // file the run just produced would be swept as an orphan.
    const generatedPathsFolded = new Set(
      [...generatedPaths].map((generatedPath) => generatedPath.toLowerCase()),
    );
    // A set, for the same reason the directory sweep uses one: two candidates
    // that report the same file delete it once and are counted once.
    const orphanPaths = new Set<string>();
    const quotedOutputRoot = JSON.stringify(stripControlCharacters(this.outputRoot));

    for (const aiDir of existingFlatFiles) {
      // Read once and delete that one value, as in the directory sweep: both
      // this and `getDirPath()` below are methods a subclass supplies, and a
      // second call could answer differently from the one that was checked.
      const filePath = aiDir.getFlatFilePath();
      if (filePath === undefined) {
        this.logger.warn(
          `Refusing to sweep ${JSON.stringify(stripControlCharacters(aiDir.getDirName()))}: it ` +
            `owns a directory of its own, or names no file directly under the root it was found in`,
        );
        continue;
      }

      const dirPath = aiDir.getDirPath();
      const { verdict, root } = locateInOwnRoot({ aiDir, dirPath, outputRoot: this.outputRoot });
      // Quoted for the same reason the directory sweep quotes: the last segment
      // of the path is a name that came off disk.
      const quotedFilePath = JSON.stringify(stripControlCharacters(filePath));
      const quotedRoot = JSON.stringify(stripControlCharacters(root));

      if (verdict === "root-outside") {
        this.logger.warn(
          `Refusing to delete ${quotedFilePath}: the root ${quotedRoot} it was found in is not ` +
            `inside ${quotedOutputRoot}, the directory this run writes to`,
        );
        continue;
      }

      // The file has to sit directly in the root the candidate was enumerated
      // from. `getDirPath()` is what the root check above ruled on, so the
      // directory the file itself is in has to be that same path — checked
      // against the path, not against the candidate's word for it, so an
      // override that returns a file somewhere else entirely is caught here
      // rather than deleting outside the root that was vetted.
      if (verdict !== "equal" || relative(resolve(dirname(filePath)), resolve(dirPath)) !== "") {
        this.logger.warn(
          `Refusing to delete ${quotedFilePath}: it is not directly inside ${quotedRoot}, the ` +
            `shared root it was found in`,
        );
        continue;
      }

      // Nothing in a root this run wrote no file into is swept. Emptying the
      // source of a flattening tool therefore leaves its last files in place,
      // to be deleted by hand — the same trade the TAKT checks block makes,
      // and the price of never mistaking a root rulesync does not manage for
      // one whose every file has gone orphan.
      if (!generatedRoots.has(dirPath)) {
        this.logger.debug(
          `Skipping orphan sweep in ${quotedRoot}: this run wrote no file into that shared root`,
        );
        continue;
      }

      if (generatedPaths.has(filePath)) {
        continue;
      }
      if (generatedPathsFolded.has(filePath.toLowerCase())) {
        this.logger.warn(
          `Refusing to delete ${quotedFilePath}: this run wrote a file whose path differs from ` +
            `it only in case, which on a case-insensitive filesystem is the very file it wrote`,
        );
        continue;
      }
      orphanPaths.add(filePath);
    }

    return await this.deleteOrphanPaths({ paths: orphanPaths, kind: "file" });
  }
}
