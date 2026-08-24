import { realpath } from "node:fs/promises";
import path, { basename, join, relative, resolve } from "node:path";

import {
  fileExists,
  findFilesByGlobs,
  isHiddenPathSegment,
  pathEscapesRoot,
  readFileBuffer,
  splitPathSegments,
  toPosixPath,
} from "../utils/file.js";
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

/** Why an entry is never carried, which decides whether its exclusion is reported. */
type NeverCarriedReason = "credential" | "noise";

/**
 * Directories that hold credentials. Excluding these protects something, so
 * their exclusion is reported rather than silent.
 */
const NEVER_CARRIED_CREDENTIAL_DIR_NAMES = new Set([".ssh", ".aws", ".gnupg"]);

/**
 * Directories that are never part of a skill for the ordinary reasons: a
 * nested repository, or a build/cache tree. Leaving these out is what a user
 * expects, so it happens quietly.
 */
const NEVER_CARRIED_NOISE_DIR_NAMES = new Set([
  ".git",
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

/** Files that hold credentials. Compared lower-cased. */
const NEVER_CARRIED_CREDENTIAL_FILE_NAMES = new Set([
  ".npmrc",
  ".netrc",
  ".git-credentials",
  ".pgpass",
  ".pypirc",
  ".htpasswd",
  ".dockercfg",
  ".envrc",
]);

/** Files that are local noise. Compared lower-cased. */
const NEVER_CARRIED_NOISE_FILE_NAMES = new Set([".ds_store"]);

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
 * Kernel pseudo-filesystems, matched against the resolved real path. A link
 * into one of these does not reach a file at all: `/proc/self/environ` reads
 * back the entire environment of the running process, API keys included, and
 * `stat` reports it as an ordinary file. Nothing a skill carries lives here.
 */
const NEVER_CARRIED_REAL_PATH_ROOTS = ["/proc", "/sys", "/dev"];

/**
 * Directory trees pruned during the walk. Derived from the directory names
 * above so the pruning and the path check below cannot drift apart. Anchored
 * with `**\/` because the include patterns are absolute, and a relative ignore
 * would silently exclude nothing.
 */
const EXCLUDED_DIR_PATTERNS = [
  ...NEVER_CARRIED_CREDENTIAL_DIR_NAMES,
  ...NEVER_CARRIED_NOISE_DIR_NAMES,
].flatMap((dirName) => [`**/${dirName}`, `**/${dirName}/**`]);

/**
 * Windows drops trailing dots and spaces from a name, so a file called `.env `
 * is written as `.env` once it lands in a tool directory there. Normalizing
 * before every comparison means the name is judged as what it becomes.
 */
function normalizePathSegment(segment: string): string {
  const normalized = segment.replace(/[\s.]+$/, "");
  return normalized === "" ? segment : normalized;
}

/**
 * Why a path reaches something that is never skill content, or `undefined`
 * when it does not.
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
function classifyNeverCarried(relativePath: string): NeverCarriedReason | undefined {
  const segments = toPosixPath(relativePath)
    .toLowerCase()
    .split("/")
    .filter((segment) => segment !== "" && segment !== ".")
    .map(normalizePathSegment);
  const fileName = segments.at(-1) ?? "";
  const posixPath = segments.join("/");

  if (segments.some((segment) => NEVER_CARRIED_CREDENTIAL_DIR_NAMES.has(segment))) {
    return "credential";
  }
  if (segments.some((segment) => NEVER_CARRIED_NOISE_DIR_NAMES.has(segment))) {
    return "noise";
  }
  if (NEVER_CARRIED_CREDENTIAL_FILE_NAMES.has(fileName)) {
    return "credential";
  }
  if (NEVER_CARRIED_NOISE_FILE_NAMES.has(fileName)) {
    return "noise";
  }
  if (
    NEVER_CARRIED_PATH_SUFFIXES.some(
      (suffix) => posixPath === suffix || posixPath.endsWith(`/${suffix}`),
    )
  ) {
    return "credential";
  }
  if (fileName === ".env") {
    return "credential";
  }
  if (fileName.startsWith(".env.")) {
    // What decides is the last piece of the name, not the whole suffix chain:
    // `.env.local.example` is as much a template as `.env.example` is.
    const lastPiece = fileName.split(".").at(-1) ?? "";
    return ENV_TEMPLATE_SUFFIXES.has(lastPiece) ? undefined : "credential";
  }
  return undefined;
}

/** Whether a resolved real path points into a kernel pseudo-filesystem. */
function isSystemPseudoPath(absolutePath: string): boolean {
  const posixPath = toPosixPath(absolutePath);
  return NEVER_CARRIED_REAL_PATH_ROOTS.some(
    (root) => posixPath === root || posixPath.startsWith(`${root}/`),
  );
}

/** How many paths a single warning names before it counts the rest. */
export const MAX_REPORTED_ESCAPED_PATHS = 10;

/** Render a set of refused or noteworthy paths for one warning line. */
function formatReportedPaths(paths: Iterable<string>): { count: number; list: string } {
  const sorted = [...paths].toSorted();
  const named = sorted.slice(0, MAX_REPORTED_ESCAPED_PATHS).map(toPosixPath).join(", ");
  const remaining = sorted.length - MAX_REPORTED_ESCAPED_PATHS;
  return {
    count: sorted.length,
    list: `${named}${remaining > 0 ? `, and ${remaining} more` : ""}`,
  };
}

/** "entry" or "entries", so the warnings below read as sentences. */
function entryWord(count: number): string {
  return count === 1 ? "entry" : "entries";
}

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
    return splitPathSegments(relativePath).some(isHiddenPathSegment);
  }

  /**
   * Drop the entries a skill directory must not carry.
   *
   * Three rules. `classifyNeverCarried` comes first, evaluated against the
   * resolved real path as well as the literal one: names that are never skill
   * content stay out however they are reached, so renaming a symbolic link
   * does not turn `~/.aws` into content a skill carries. Next, a real path
   * inside a kernel pseudo-filesystem is refused outright — that is process
   * state, not a file.
   *
   * The third concerns hidden entries a symbolic link reaches outside the
   * directory. Following symlinks out of a source tree is deliberate and
   * documented — it is how a shared skill is referenced from several projects
   * without being duplicated (issue #1707), and the trust boundary is the tree
   * you point Rulesync at. Carrying hidden entries changes what that costs,
   * though: one ordinary-looking link to a home directory would pull in every
   * dotfile under it, and those are the entries with credential value. What
   * decides is the name in the skill directory, not what the link resolves
   * through: a named file keeps its documented behavior even when the target
   * sits under a dot-directory such as `~/.dotfiles`, because somebody chose
   * that name. Reaching outside is reported either way, since content from
   * outside the tree is about to be copied into every enabled tool root.
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

    const refusedCredentials = new Set<string>();
    const refusedPseudoPaths = new Set<string>();
    const refusedEscapedHidden = new Set<string>();
    const carriedFromOutside = new Set<string>();

    const verdicts = await Promise.all(
      filePaths.map(async (filePath) => {
        const literalPath = relative(dirPath, filePath);
        const literalReason = classifyNeverCarried(literalPath);
        if (literalReason !== undefined) {
          if (literalReason === "credential") {
            refusedCredentials.add(filePath);
          }
          return false;
        }

        let realFilePath: string;
        try {
          realFilePath = await realpath(filePath);
        } catch {
          return true;
        }

        if (isSystemPseudoPath(realFilePath)) {
          refusedPseudoPaths.add(filePath);
          return false;
        }

        const realPath = relative(realDirPath, realFilePath);
        const realReason = classifyNeverCarried(realPath);
        if (realReason !== undefined) {
          if (realReason === "credential") {
            refusedCredentials.add(filePath);
          }
          return false;
        }

        if (!pathEscapesRoot(realPath)) {
          return true;
        }
        if (AiDir.hasHiddenSegment(literalPath)) {
          refusedEscapedHidden.add(filePath);
          return false;
        }
        carriedFromOutside.add(filePath);
        return true;
      }),
    );

    if (refusedCredentials.size > 0) {
      const { count, list } = formatReportedPaths(refusedCredentials);
      warnWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} named as a credential store: ${list}. A skill must not ship secrets; read them from the environment instead.`,
      );
    }
    if (refusedPseudoPaths.size > 0) {
      const { count, list } = formatReportedPaths(refusedPseudoPaths);
      warnWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} that a symbolic link points into a system pseudo-filesystem: ${list}. Those read back process state, not skill content.`,
      );
    }
    if (refusedEscapedHidden.size > 0) {
      const { count, list } = formatReportedPaths(refusedEscapedHidden);
      warnWithFallback(
        undefined,
        `Not carrying ${count} hidden ${entryWord(count)} that a symbolic link reaches outside ${toPosixPath(dirPath)}: ${list}. Copy them into the directory if the skill really needs them.`,
      );
    }
    if (carriedFromOutside.size > 0) {
      const { count, list } = formatReportedPaths(carriedFromOutside);
      warnWithFallback(
        undefined,
        `Carrying ${count} ${entryWord(count)} that a symbolic link reaches outside ${toPosixPath(dirPath)}: ${list}. Their content is copied into every generated tool directory.`,
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
   * as decided by `classifyNeverCarried`. Whole directories from that set are
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
