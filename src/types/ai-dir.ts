import { realpath } from "node:fs/promises";
import path, { basename, isAbsolute, join, relative, resolve } from "node:path";

import { fileExists, findFilesByGlobs, readFileBuffer, toPosixPath } from "../utils/file.js";
import { warnWithFallback } from "../utils/logger.js";

export type ValidationResult =
  | {
      success: true;
      error: undefined | null;
    }
  | {
      success: false;
      error: Error;
    };

export type AiDirFile = {
  relativeFilePathToDirPath: string;
  fileBuffer: Buffer;
  /**
   * Set on a file rulesync composes itself rather than carries through from the
   * source directory (Codex CLI's `agents/openai.yaml`). Such a file is
   * compared structurally, so a formatter re-indenting it is not reported as a
   * change on every generate; a carried-through user asset is compared — and
   * always written — byte for byte.
   */
  composed?: boolean;
};

/**
 * Directories that are never part of a skill: a nested repository, a credential
 * store, or a build/cache tree. Their names are also the pruning patterns
 * below, so the walk never descends into them.
 */
const NEVER_CARRIED_DIR_NAMES = new Set([
  ".git",
  ".ssh",
  ".aws",
  ".gnupg",
  ".venv",
  ".tox",
  ".mypy_cache",
  ".pytest_cache",
  ".ruff_cache",
  ".gradle",
  ".next",
  ".nuxt",
  ".turbo",
  ".parcel-cache",
  ".nyc_output",
  ".terraform",
]);

/** Files that are local noise or hold credentials. Compared lower-cased. */
const NEVER_CARRIED_FILE_NAMES = new Set([
  ".ds_store",
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".pgpass",
  ".pypirc",
  ".htpasswd",
  ".dockercfg",
  ".envrc",
]);

/** Credential files whose parent directory is otherwise ordinary content. */
const NEVER_CARRIED_PATH_SUFFIXES = [
  ".docker/config.json",
  ".kube/config",
  ".config/gh/hosts.yml",
  ".config/gcloud/credentials.db",
  ".gem/credentials",
];

/**
 * `.env.<suffix>` spellings that are templates rather than real values.
 * Everything else matching `.env*` is treated as holding secrets, because
 * `.env.production` is no less sensitive than `.env` itself.
 */
const ENV_TEMPLATE_SUFFIXES = new Set(["example", "sample", "template", "dist", "defaults"]);

/**
 * Directory trees pruned during the walk. Derived from the directory names
 * above so the pruning and the path check below cannot drift apart. Anchored
 * with `**\/` because the include patterns are absolute, and a relative ignore
 * would silently exclude nothing.
 */
const EXCLUDED_DIR_PATTERNS = [...NEVER_CARRIED_DIR_NAMES].flatMap((dirName) => [
  `**/${dirName}`,
  `**/${dirName}/**`,
]);

/**
 * Whether a path reaches something that is never skill content.
 *
 * Carrying hidden entries means a secret sitting in a skill directory would be
 * copied into every enabled tool root, multiplying the places it can be
 * committed from, and a `.venv` would be copied file by file into each of them.
 * None of these names is ever skill content, so excluding them costs nothing.
 *
 * The check is applied to the resolved real path as well as the literal one:
 * the names are what makes an entry dangerous, and a symbolic link named
 * `vendor` pointing at `~/.aws` is exactly as dangerous as a directory called
 * `.aws`. Comparison is lower-cased because macOS and Windows resolve `.SSH`
 * and `.ssh` to the same file.
 */
function isNeverCarriedPath(relativePath: string): boolean {
  const posixPath = toPosixPath(relativePath).toLowerCase();
  const segments = posixPath.split("/").filter((segment) => segment !== "" && segment !== ".");
  const fileName = segments.at(-1) ?? "";

  if (segments.some((segment) => NEVER_CARRIED_DIR_NAMES.has(segment))) {
    return true;
  }
  if (NEVER_CARRIED_FILE_NAMES.has(fileName)) {
    return true;
  }
  if (
    NEVER_CARRIED_PATH_SUFFIXES.some(
      (suffix) => posixPath === suffix || posixPath.endsWith(`/${suffix}`),
    )
  ) {
    return true;
  }
  if (fileName === ".env") {
    return true;
  }
  if (fileName.startsWith(".env.")) {
    return !ENV_TEMPLATE_SUFFIXES.has(fileName.slice(".env.".length));
  }
  return false;
}

/** How many escaped hidden paths a single warning names before counting the rest. */
export const MAX_REPORTED_ESCAPED_PATHS = 10;

export type AiDirParams = {
  outputRoot?: string;
  relativeDirPath: string;
  dirName: string;
  mainFile?: {
    name: string;
    body: string;
    frontmatter?: Record<string, unknown>;
  };
  otherFiles?: AiDirFile[];
  global?: boolean;
};

export type AiDirFromDirParams = Pick<
  AiDirParams,
  "outputRoot" | "relativeDirPath" | "dirName" | "global"
>;

export abstract class AiDir {
  /**
   * @example "."
   */
  protected readonly outputRoot: string;

  /**
   * @example ".rulesync/skills"
   */
  protected readonly relativeDirPath: string;

  /**
   * @example "my-skill"
   */
  protected readonly dirName: string;

  /**
   * Optional main file with frontmatter support
   */
  protected mainFile?: {
    name: string;
    body: string;
    frontmatter?: Record<string, unknown>;
  };

  /**
   * Additional files in the directory
   */
  protected otherFiles: AiDirFile[];

  /**
   * @example false
   */
  protected readonly global: boolean;

  constructor({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    mainFile,
    otherFiles = [],
    global = false,
  }: AiDirParams) {
    // Security check: ensure dirName doesn't contain path separators
    if (dirName.includes(path.sep) || dirName.includes("/") || dirName.includes("\\")) {
      throw new Error(`Directory name cannot contain path separators: dirName="${dirName}"`);
    }

    this.outputRoot = outputRoot;
    this.relativeDirPath = relativeDirPath;
    this.dirName = dirName;
    this.mainFile = mainFile;
    this.otherFiles = otherFiles;
    this.global = global;
  }

  static async fromDir(_params: AiDirFromDirParams): Promise<AiDir> {
    throw new Error("Please implement this method in the subclass.");
  }

  getOutputRoot(): string {
    return this.outputRoot;
  }

  getRelativeDirPath(): string {
    return this.relativeDirPath;
  }

  getDirName(): string {
    return this.dirName;
  }

  getDirPath(): string {
    const fullPath = path.join(this.outputRoot, this.relativeDirPath, this.dirName);

    // Security check: ensure the final path doesn't escape outputRoot via path traversal
    // This prevents attacks like: new AiDir({ relativeDirPath: "../../etc", ... })
    const resolvedFull = resolve(fullPath);
    const resolvedBase = resolve(this.outputRoot);
    const rel = relative(resolvedBase, resolvedFull);

    // Check if the resolved path is outside outputRoot
    if (rel.startsWith("..") || path.isAbsolute(rel)) {
      throw new Error(
        `Path traversal detected: Final path escapes outputRoot. ` +
          `outputRoot="${this.outputRoot}", relativeDirPath="${this.relativeDirPath}", ` +
          `dirName="${this.dirName}"`,
      );
    }

    return fullPath;
  }

  getMainFile():
    | {
        name: string;
        body: string;
        frontmatter?: Record<string, unknown>;
      }
    | undefined {
    return this.mainFile;
  }

  getOtherFiles(): AiDirFile[] {
    return this.otherFiles;
  }

  /**
   * Returns the relative path from CWD with POSIX separators for consistent cross-platform output.
   */
  getRelativePathFromCwd(): string {
    return toPosixPath(path.join(this.relativeDirPath, this.dirName));
  }

  getGlobal(): boolean {
    return this.global;
  }

  setMainFile(name: string, body: string, frontmatter?: Record<string, unknown>): void {
    this.mainFile = { name, body, frontmatter };
  }

  /**
   * A nested repository inside a carried directory is the one exclusion worth
   * reporting: unlike `.DS_Store`, it is there on purpose, and the tree it
   * points at is simply not reproduced on generate. Only the top level is
   * checked, which is where a submodule or a stray `git init` puts it, so the
   * check costs one stat per directory rather than a second walk. `fileExists`
   * is a bare `stat`, so it answers for a submodule pointer file and for a real
   * `.git` directory alike.
   */
  private static async warnOnNestedGitDirectory(dirPath: string): Promise<void> {
    const gitEntryPath = join(dirPath, ".git");
    if (await fileExists(gitEntryPath)) {
      warnWithFallback(
        undefined,
        `Not carrying ${toPosixPath(gitEntryPath)} with its directory: a nested repository is excluded, so the files it tracks are copied but its history is not.`,
      );
    }
  }

  /** Whether any segment of a relative path is dot-prefixed. */
  private static hasHiddenSegment(relativePath: string): boolean {
    return relativePath
      .split(/[/\\]/)
      .some((segment) => segment.startsWith(".") && segment !== "." && segment !== "..");
  }

  /**
   * Whether a relative path leads out of the directory it is relative to.
   * Matching whole segments matters here: a directory really named `..cache`
   * relatively resolves to `..cache/file`, which a prefix test would report as
   * an escape.
   */
  private static escapesDirectory(relativePath: string): boolean {
    return (
      relativePath === ".." || relativePath.startsWith(`..${path.sep}`) || isAbsolute(relativePath)
    );
  }

  /**
   * Drop the entries a skill directory must not carry.
   *
   * Two rules, both evaluated against the resolved real path as well as the
   * literal one. The first is `isNeverCarriedPath`: names that are never skill
   * content stay out however they are reached, so renaming a symbolic link
   * does not turn `~/.aws` into content a skill carries.
   *
   * The second concerns hidden entries a symbolic link reaches outside the
   * directory. Following symlinks out of a source tree is deliberate and
   * documented — it is how a shared skill is referenced from several projects
   * without being duplicated (issue #1707), and the trust boundary is the tree
   * you point Rulesync at. Carrying hidden entries changes what that costs,
   * though: one ordinary-looking link to a home directory would pull in every
   * dotfile under it, and those are the entries with credential value. Named
   * files reached the same way keep their documented behavior, since somebody
   * chose those names; nothing chose the dotfiles.
   *
   * A path that cannot be resolved is kept: `realpath` fails on a broken link
   * or a race, and neither is a reason to silently drop a file.
   */
  private static async filterCarriedFiles(dirPath: string, filePaths: string[]): Promise<string[]> {
    let realDirPath: string;
    try {
      realDirPath = await realpath(dirPath);
    } catch {
      realDirPath = resolve(dirPath);
    }

    const escaped = new Set<string>();
    const verdicts = await Promise.all(
      filePaths.map(async (filePath) => {
        const literalPath = relative(dirPath, filePath);
        if (isNeverCarriedPath(literalPath)) {
          return false;
        }

        let realFilePath: string;
        try {
          realFilePath = await realpath(filePath);
        } catch {
          return true;
        }

        const realPath = relative(realDirPath, realFilePath);
        if (isNeverCarriedPath(realPath)) {
          return false;
        }
        if (
          AiDir.escapesDirectory(realPath) &&
          (AiDir.hasHiddenSegment(literalPath) || AiDir.hasHiddenSegment(realPath))
        ) {
          escaped.add(filePath);
          return false;
        }
        return true;
      }),
    );

    if (escaped.size > 0) {
      const reported = [...escaped].toSorted();
      const named = reported.slice(0, MAX_REPORTED_ESCAPED_PATHS).map(toPosixPath).join(", ");
      const remaining = reported.length - MAX_REPORTED_ESCAPED_PATHS;
      warnWithFallback(
        undefined,
        `Not carrying ${reported.length} hidden ${reported.length === 1 ? "entry" : "entries"} that a symbolic link reaches outside ${toPosixPath(dirPath)}: ${named}${remaining > 0 ? `, and ${remaining} more` : ""}. Copy them into the directory if the skill really needs them.`,
      );
    }

    return filePaths.filter((_filePath, index) => verdicts[index]);
  }

  /**
   * Recursively collects all files from a directory, excluding the specified main file.
   * This is a common utility for loading additional files alongside the main file.
   *
   * Hidden entries are included. The directories this walks are skill trees,
   * whose specification says a skill directory "may contain any files and
   * directories beyond the required `SKILL.md`" — a `.env.example` beside the
   * scripts that read it is content, not noise, and dropping it silently on
   * both import and generate loses part of the skill. What is left out is the
   * set of entries that are never skill content — a nested repository's `.git`,
   * the macOS Finder's `.DS_Store`, credential stores, build and cache trees —
   * as decided by `isNeverCarriedPath`. Whole directories from that set are
   * pruned during the walk too, so it never descends into them at all.
   *
   * @see https://agentskills.io/specification
   *
   * @param outputRoot - The base directory path
   * @param relativeDirPath - The relative path to the directory containing the skill
   * @param dirName - The name of the directory
   * @param excludeFileName - The name of the file to exclude (typically the main file)
   * @returns Array of files with their relative paths and buffers
   */
  protected static async collectOtherFiles(
    outputRoot: string,
    relativeDirPath: string,
    dirName: string,
    excludeFileName: string,
  ): Promise<AiDirFile[]> {
    const dirPath = join(outputRoot, relativeDirPath, dirName);
    const glob = join(dirPath, "**", "*");
    const discoveredPaths = await findFilesByGlobs(glob, {
      type: "file",
      dot: true,
      ignore: EXCLUDED_DIR_PATTERNS,
    });
    await AiDir.warnOnNestedGitDirectory(dirPath);
    const filePaths = await AiDir.filterCarriedFiles(dirPath, discoveredPaths);
    const filteredPaths = filePaths.filter((filePath) => basename(filePath) !== excludeFileName);

    const files: AiDirFile[] = await Promise.all(
      filteredPaths.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeFilePathToDirPath: relative(dirPath, filePath),
          fileBuffer,
        };
      }),
    );

    return files;
  }

  abstract validate(): ValidationResult;
}
