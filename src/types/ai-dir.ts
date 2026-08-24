import { constants, type Dirent, type Stats } from "node:fs";
import type { FileHandle } from "node:fs/promises";
import { lstat, open, readdir, readlink, realpath, stat } from "node:fs/promises";
import path, { basename, dirname, isAbsolute, join, relative, resolve } from "node:path";

import { mapWithConcurrency } from "../utils/concurrency.js";
import { stripControlCharacters } from "../utils/control-characters.js";
import { formatError } from "../utils/error.js";
import {
  fileExists,
  isHiddenPathSegment,
  pathEscapesRoot,
  splitPathSegments,
  toPosixPath,
} from "../utils/file.js";
import { warnOnceWithFallback } from "../utils/logger.js";

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
 * Directories that are refused only when the path leaves the skill directory to
 * reach them. These are the per-application trees of a home directory, where
 * naming every credential file is a list always one release behind -- `gcloud`
 * alone writes `credentials.db` and `application_default_credentials.json`, and
 * `.config/anthropic/` holds an API key. A skill that ships a `.config/` of its
 * own still carries it: what is refused is a link that reaches the *user's*.
 */
const NEVER_CARRIED_ESCAPING_DIR_NAMES = new Set([".config", ".local", ".azure"]);

/** Whether an escaping real path passes through a directory only reachable by escaping. */
function escapesIntoCredentialDir(realFilePath: string): boolean {
  return splitPathSegments(realFilePath).some((segment) =>
    NEVER_CARRIED_ESCAPING_DIR_NAMES.has(normalizePathSegment(segment.toLowerCase())),
  );
}

/**
 * Directories that are never part of a skill for the ordinary reasons: a
 * nested repository, or a build/cache tree. Leaving these out is what a user
 * expects, so it happens quietly.
 */
const NEVER_CARRIED_NOISE_DIR_NAMES = new Set([
  ".git",
  ".hg",
  ".svn",
  ".cache",
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
  "gcloud/application_default_credentials.json",
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
 * Whether a directory of this name is pruned during the walk, so it is never
 * descended into at all. Derived from the directory names above so the pruning
 * and the path check below cannot drift apart.
 */
function isNeverCarriedDirName(dirName: string): boolean {
  const normalized = normalizePathSegment(dirName.toLowerCase());
  return (
    NEVER_CARRIED_CREDENTIAL_DIR_NAMES.has(normalized) ||
    NEVER_CARRIED_NOISE_DIR_NAMES.has(normalized)
  );
}

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
  // `.envrc` alongside `.env`: direnv keeps real values in `.envrc.local` and
  // `.envrc.private` as routinely as a project keeps them in `.env.local`.
  for (const base of [".env", ".envrc"]) {
    if (fileName === base) {
      return "credential";
    }
    if (fileName.startsWith(`${base}.`)) {
      // What decides is the last piece of the name, not the whole suffix chain:
      // `.env.local.example` is as much a template as `.env.example` is, and a
      // `.dist` or `.example` marker means template whichever environment name
      // precedes it.
      const lastPiece = fileName.split(".").at(-1) ?? "";
      return ENV_TEMPLATE_SUFFIXES.has(lastPiece) ? undefined : "credential";
    }
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

/** How many links a chain may be followed before it is treated as a loop. */
const MAX_LINK_CHAIN_HOPS = 40;

/**
 * Whether reaching a path goes through a kernel pseudo-filesystem, even when it
 * does not end in one.
 *
 * Asking `realpath` alone is not enough, and the entries it is not enough for
 * are the dangerous ones: `/proc/<pid>/fd/N`, `exe`, `cwd` and `root` are magic
 * links, so resolving them lands *outside* `/proc`, on whatever file the
 * process happens to hold open — a private key another program is reading right
 * now would come back as an ordinary path and be carried. Following the chain a
 * hop at a time, and checking each hop, is what sees the `/proc` in the middle.
 */
async function resolvesThroughSystemPseudoPath(filePath: string): Promise<boolean> {
  let currentPath = resolve(filePath);
  for (let hop = 0; hop < MAX_LINK_CHAIN_HOPS; hop++) {
    if (isSystemPseudoPath(currentPath)) {
      return true;
    }
    let linkStats: Stats;
    try {
      linkStats = await lstat(currentPath);
    } catch {
      return false;
    }
    if (!linkStats.isSymbolicLink()) {
      break;
    }
    let target: string;
    try {
      target = await readlink(currentPath);
    } catch {
      return false;
    }
    currentPath = isAbsolute(target) ? target : resolve(dirname(currentPath), target);
  }
  try {
    return isSystemPseudoPath(await realpath(dirname(filePath)));
  } catch {
    return false;
  }
}

/**
 * Bounds on what one directory may carry. A single link to a home directory
 * reaches a tree of any size, so a tree somebody else wrote could otherwise
 * exhaust the heap. The depth is far past any real skill layout; the count and
 * the total size mirror what `git-client.ts` allows a fetched repository.
 *
 * These are enforced *while walking*, not after: a bound applied to the result
 * of the walk is a bound applied to an array that already grew without one.
 */
export const MAX_CARRIED_DEPTH = 12;
export const MAX_CARRIED_FILES = 10_000;
export const MAX_CARRIED_DIRECTORIES = 10_000;
/**
 * The bounds above limit what is *carried*; this one limits what is *looked at*.
 * A directory holding nothing but a few hundred thousand links to itself carries
 * no files and occupies no depth, and would still cost a `stat` apiece.
 */
export const MAX_CARRIED_ENTRIES_EXAMINED = 200_000;
export const MAX_CARRIED_BYTES = 100 * 1024 * 1024;

/** How many `realpath` calls the carried-file filter keeps in flight. */
const CARRIED_REALPATH_CONCURRENCY = 32;

/** Sort directory entries by name so a walk of the same tree is reproducible. */
function compareByName(left: Dirent, right: Dirent): number {
  if (left.name === right.name) {
    return 0;
  }
  return left.name < right.name ? -1 : 1;
}

/** Why a walk stopped early, so the shortfall can be reported rather than silent. */
type CarriedWalkTruncation = "depth" | "count" | "directories" | "entries";

/** A directory the walk has yet to enter, and what reaching it cost. */
type PendingCarriedDir = {
  dirPath: string;
  depth: number;
  /** Dot-prefixed segments below the carried directory, ties broken by path. */
  hiddenSegments: number;
};

/**
 * Order the routes that cross the same number of symbolic links: the one with
 * the fewest hidden segments first, so a named alias represents a shared tree
 * rather than a hidden one that a hidden-entry rule then refuses, taking the
 * named route's content with it.
 */
function comparePendingCarriedDirs(left: PendingCarriedDir, right: PendingCarriedDir): number {
  if (left.hiddenSegments !== right.hiddenSegments) {
    return left.hiddenSegments - right.hiddenSegments;
  }
  // The shallower route next: it leaves more of the depth bound for whatever the
  // directory itself contains, so a tree claimed through a deep route does not
  // lose its own lower levels.
  if (left.depth !== right.depth) {
    return left.depth - right.depth;
  }
  if (left.dirPath === right.dirPath) {
    return 0;
  }
  return left.dirPath < right.dirPath ? -1 : 1;
}

/**
 * What a filtering pass decided about one walk's paths. The refusals travel back
 * to the caller rather than being reported here, because a second pass may still
 * carry the same file through a route this one had to refuse.
 */
type CarriedFilterResult = {
  filePaths: string[];
  realFilePathByPath: Map<string, string>;
  refusedCredentials: Set<string>;
  refusedPseudoPaths: Set<string>;
  refusedEscapedHidden: Set<string>;
  refusedNoiseAliases: Set<string>;
  carriedFromOutside: Set<string>;
};

type CarriedWalkResult = {
  filePaths: string[];
  truncations: Set<CarriedWalkTruncation>;
  unreadablePaths: string[];
  /** Linked directories the walk refused to descend into, reported by the caller. */
  pseudoPaths: string[];
};

/**
 * Collect the files under a carried directory, following symbolic links but
 * visiting each real directory exactly once, by its cheapest route.
 *
 * A glob walk cannot do this safely. Two links in one directory that both point
 * back at an ancestor double the paths walked per level, and the walker follows
 * them until the kernel's ELOOP limit (~40), so the path array alone exhausts
 * the heap long before anything reads a file — a depth bound only lowers the
 * exponent, while the base is whatever number of links the tree's author chose.
 * Remembering the real directories already visited removes the multiplication
 * itself: a cycle, and an alias for a directory already walked, both stop at the
 * entry that closes them.
 *
 * Which route represents a directory then matters, because the others are
 * dropped. The walk proceeds in rounds by the number of symbolic links crossed:
 * everything reachable without crossing one, then everything one link away, and
 * so on. A real location therefore always wins over an alias for it — at any
 * nesting depth, not just among siblings, which a depth-first walk could not
 * promise — and among aliases the named one wins over a hidden one.
 *
 * A broken link is skipped: it resolves to nothing to read.
 */
async function walkCarriedFiles(
  dirPath: string,
  { skipHiddenRoutes = false }: { skipHiddenRoutes?: boolean } = {},
): Promise<CarriedWalkResult> {
  const filePaths: string[] = [];
  const visitedRealDirPaths = new Set<string>();
  const truncations = new Set<CarriedWalkTruncation>();
  const unreadablePaths = new Set<string>();
  const pseudoPaths = new Set<string>();
  // A route the depth bound stopped costs nothing if another route reaches the
  // same directory within the bound, which is why the verdict waits for the end.
  const depthStoppedRealDirPaths = new Set<string>();
  let deferredLinkedDirs: PendingCarriedDir[] = [];

  /** Whether the walk has hit a bound that ends it rather than one branch of it. */
  let examinedEntries = 0;
  const isFull = (): boolean =>
    truncations.has("count") || truncations.has("directories") || truncations.has("entries");

  const addFile = (filePath: string): void => {
    if (filePaths.length >= MAX_CARRIED_FILES) {
      truncations.add("count");
      return;
    }
    filePaths.push(filePath);
  };

  /** Carry what a symbolic link names, or hold its directory for the next round. */
  const routeLinkedEntry = async (child: PendingCarriedDir, entryName: string): Promise<void> => {
    let targetStats: Stats;
    try {
      targetStats = await stat(child.dirPath);
    } catch {
      // A broken link resolves to nothing to read.
      return;
    }
    if (targetStats.isFile()) {
      addFile(child.dirPath);
      return;
    }
    if (!targetStats.isDirectory() || isNeverCarriedDirName(entryName)) {
      return;
    }
    if (await resolvesThroughSystemPseudoPath(child.dirPath)) {
      // Walking `/proc` would read back process state, and its `<pid>/fd`
      // entries would hand out whatever every process on the machine has open.
      // It is also a tree of tens of thousands of entries.
      pseudoPaths.add(child.dirPath);
      return;
    }
    deferredLinkedDirs.push(child);
  };

  /** Walk one directory and everything below it that no symbolic link leads to. */
  const walkWithoutCrossingLinks = async (pending: PendingCarriedDir): Promise<void> => {
    if (isFull()) {
      return;
    }
    let realCurrentPath: string;
    try {
      realCurrentPath = await realpath(pending.dirPath);
    } catch {
      unreadablePaths.add(pending.dirPath);
      return;
    }
    // A route to a directory already covered loses nothing, so it is not a
    // truncation even when it is the depth bound that stops it -- which is
    // exactly what a cycle produces.
    if (visitedRealDirPaths.has(realCurrentPath)) {
      return;
    }
    if (pending.depth > MAX_CARRIED_DEPTH) {
      depthStoppedRealDirPaths.add(realCurrentPath);
      return;
    }
    if (visitedRealDirPaths.size >= MAX_CARRIED_DIRECTORIES) {
      truncations.add("directories");
      return;
    }
    visitedRealDirPaths.add(realCurrentPath);

    let entries: Dirent[];
    try {
      entries = await readdir(pending.dirPath, { withFileTypes: true });
    } catch {
      unreadablePaths.add(pending.dirPath);
      return;
    }

    const realSubDirs: PendingCarriedDir[] = [];
    for (const entry of entries.toSorted(compareByName)) {
      if (isFull()) {
        return;
      }
      examinedEntries += 1;
      if (examinedEntries > MAX_CARRIED_ENTRIES_EXAMINED) {
        truncations.add("entries");
        return;
      }
      if (skipHiddenRoutes && isHiddenPathSegment(entry.name)) {
        continue;
      }
      const entryPath = join(pending.dirPath, entry.name);
      const child: PendingCarriedDir = {
        dirPath: entryPath,
        depth: pending.depth + 1,
        hiddenSegments: pending.hiddenSegments + (isHiddenPathSegment(entry.name) ? 1 : 0),
      };
      if (entry.isFile()) {
        addFile(entryPath);
        continue;
      }
      if (entry.isDirectory()) {
        if (!isNeverCarriedDirName(entry.name)) {
          realSubDirs.push(child);
        }
        continue;
      }
      if (!entry.isSymbolicLink()) {
        // A socket, a FIFO, or a device is never skill content.
        continue;
      }
      await routeLinkedEntry(child, entry.name);
    }

    for (const realSubDir of realSubDirs) {
      if (isFull()) {
        return;
      }
      await walkWithoutCrossingLinks(realSubDir);
    }
  };

  let round: PendingCarriedDir[] = [{ dirPath, depth: 0, hiddenSegments: 0 }];
  while (round.length > 0 && !isFull()) {
    deferredLinkedDirs = [];
    for (const pending of round.toSorted(comparePendingCarriedDirs)) {
      if (isFull()) {
        break;
      }
      await walkWithoutCrossingLinks(pending);
    }
    round = deferredLinkedDirs;
  }

  for (const realDirPath of depthStoppedRealDirPaths) {
    if (!visitedRealDirPaths.has(realDirPath)) {
      truncations.add("depth");
      break;
    }
  }

  return {
    filePaths: filePaths.toSorted(),
    truncations,
    unreadablePaths: [...unreadablePaths],
    pseudoPaths: [...pseudoPaths],
  };
}

/** How many paths a single warning names before it counts the rest. */
export const MAX_REPORTED_PATHS = 10;

/** Render a set of refused or noteworthy paths for one warning line. */
function formatReportedPaths(paths: Iterable<string>): { count: number; list: string } {
  const sorted = [...paths].toSorted();
  // The names come from a tree that may have been cloned from anywhere, and two
  // of these warnings report paths whose names an attacker picks; a file called
  // `a\r[2K` must not be able to rewrite the line it is printed on.
  const named = sorted
    .slice(0, MAX_REPORTED_PATHS)
    .map((filePath) => stripControlCharacters(toPosixPath(filePath)))
    .join(", ");
  const remaining = sorted.length - MAX_REPORTED_PATHS;
  return {
    count: sorted.length,
    list: `${named}${remaining > 0 ? `, and ${remaining} more` : ""}`,
  };
}

/** "entry" or "entries", so the warnings below read as sentences. */
function entryWord(count: number): string {
  return count === 1 ? "entry" : "entries";
}

/** "resolves" or "resolve", to agree with the entry count it follows. */
function resolveWord(count: number): string {
  return count === 1 ? "resolves" : "resolve";
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
    if (pathEscapesRoot(rel)) {
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
      warnOnceWithFallback(
        undefined,
        `Not carrying ${stripControlCharacters(toPosixPath(gitEntryPath))} with its directory: a nested repository is excluded, so the files it tracks are copied but its history is not.`,
      );
    }
  }

  /** Whether any segment of a relative path is dot-prefixed. */
  private static hasHiddenSegment(relativePath: string): boolean {
    return splitPathSegments(relativePath).some(isHiddenPathSegment);
  }

  /**
   * Whether the entry a path ends at is itself hidden, its ancestors aside.
   * A shared skill tree usually lives under a dot-directory, so an ancestor
   * says nothing about the file; its own name is what was chosen for it.
   */
  private static hasHiddenName(relativePath: string): boolean {
    return isHiddenPathSegment(splitPathSegments(relativePath).at(-1) ?? "");
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
   * that name. What the link resolves *to* still counts at the end of the path,
   * though — `notes.md` pointing at `~/.claude/.credentials.json` reaches a
   * file nobody named for a skill — so a hidden final segment is refused on
   * either side. Reaching outside is reported either way, since content from
   * outside the tree is about to be copied into every enabled tool root.
   *
   * A path that cannot be resolved is kept: `realpath` fails on a broken link
   * or a race, and neither is a reason to silently drop a file.
   */
  /** Report what a carried directory left out, once both walks have had their say. */
  private static warnOnRefusedCarriedFiles(dirPath: string, carried: CarriedFilterResult): void {
    const reportedDirPath = stripControlCharacters(toPosixPath(dirPath));
    if (carried.refusedCredentials.size > 0) {
      const { count, list } = formatReportedPaths(carried.refusedCredentials);
      warnOnceWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} named as a credential store: ${list}. A skill must not ship secrets; read them from the environment instead.`,
      );
    }
    if (carried.refusedPseudoPaths.size > 0) {
      const { count, list } = formatReportedPaths(carried.refusedPseudoPaths);
      warnOnceWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} that ${resolveWord(count)} into a system pseudo-filesystem: ${list}. Those read back process state, not skill content.`,
      );
    }
    if (carried.refusedNoiseAliases.size > 0) {
      const { count, list } = formatReportedPaths(carried.refusedNoiseAliases);
      warnOnceWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} that ${resolveWord(count)} into a directory a skill never carries: ${list}. A nested repository, or a build or cache tree, is the usual target.`,
      );
    }
    if (carried.refusedEscapedHidden.size > 0) {
      const { count, list } = formatReportedPaths(carried.refusedEscapedHidden);
      warnOnceWithFallback(
        undefined,
        `Not carrying ${count} hidden ${entryWord(count)} that ${resolveWord(count)} outside ${reportedDirPath}: ${list}. Copy them into the directory if the skill really needs them.`,
      );
    }
    if (carried.carriedFromOutside.size > 0) {
      // Named with what they resolve to: `vendor/3` says nothing about whether
      // the file it reaches is a shared reference or a private key.
      const { count, list } = formatReportedPaths(
        [...carried.carriedFromOutside].map((filePath) => {
          const realFilePath = carried.realFilePathByPath.get(filePath);
          return realFilePath === undefined ? filePath : `${filePath} -> ${realFilePath}`;
        }),
      );
      warnOnceWithFallback(
        undefined,
        `Carrying ${count} ${entryWord(count)} that ${resolveWord(count)} outside ${reportedDirPath}: ${list}. Their content is copied into every generated tool directory.`,
      );
    }
  }

  private static async filterCarriedFiles(
    dirPath: string,
    filePaths: string[],
  ): Promise<CarriedFilterResult> {
    let realDirPath: string;
    try {
      realDirPath = await realpath(dirPath);
    } catch {
      realDirPath = resolve(dirPath);
    }

    const refusedCredentials = new Set<string>();
    const refusedPseudoPaths = new Set<string>();
    const refusedEscapedHidden = new Set<string>();
    const refusedNoiseAliases = new Set<string>();
    const carriedFromOutside = new Set<string>();
    const realFilePathByPath = new Map<string, string>();

    // Bounded rather than `Promise.all`: a carried directory can hold thousands
    // of entries, and one `realpath` per entry all at once queues that many
    // closures on the thread pool before the first of them answers.
    const verdicts = await mapWithConcurrency({
      items: filePaths,
      limit: CARRIED_REALPATH_CONCURRENCY,
      mapper: async (filePath: string) => {
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
        realFilePathByPath.set(filePath, realFilePath);

        if (isSystemPseudoPath(realFilePath)) {
          refusedPseudoPaths.add(filePath);
          return false;
        }

        const realPath = relative(realDirPath, realFilePath);
        const realReason = classifyNeverCarried(realPath);
        if (realReason !== undefined) {
          if (realReason === "credential") {
            refusedCredentials.add(filePath);
          } else {
            // The literal path said nothing about it -- a link renamed the tree,
            // or its target simply lives under one -- so leaving it out silently
            // would give the author no hint at all.
            refusedNoiseAliases.add(filePath);
          }
          return false;
        }

        if (!pathEscapesRoot(realPath)) {
          return true;
        }
        // Only a path that resolves outside the directory can have gone through
        // `/proc`, so the extra walk of the link chain is paid for by those.
        if (await resolvesThroughSystemPseudoPath(filePath)) {
          refusedPseudoPaths.add(filePath);
          return false;
        }
        if (escapesIntoCredentialDir(realFilePath)) {
          refusedCredentials.add(filePath);
          return false;
        }
        if (AiDir.hasHiddenSegment(literalPath) || AiDir.hasHiddenName(realPath)) {
          refusedEscapedHidden.add(filePath);
          return false;
        }
        carriedFromOutside.add(filePath);
        return true;
      },
    });

    // The warnings are the caller's to emit: a path refused here may still be
    // carried through another route, and a shortfall reported before that is
    // settled would send the author to fix something that is not broken.
    return {
      filePaths: filePaths.filter((_filePath, index) => verdicts[index]),
      realFilePathByPath,
      refusedCredentials,
      refusedPseudoPaths,
      refusedEscapedHidden,
      refusedNoiseAliases,
      carriedFromOutside,
    };
  }

  /**
   * Report what the walk had to leave behind, so a skill that silently lost
   * files says so rather than generating a directory that is quietly short.
   */
  private static warnOnCarriedWalkLimits({
    reportedDirPath,
    truncations,
    unreadablePaths,
  }: {
    reportedDirPath: string;
    truncations: Set<CarriedWalkTruncation>;
    unreadablePaths: string[];
  }): void {
    if (truncations.has("depth")) {
      warnOnceWithFallback(
        undefined,
        `Not carrying the entries more than ${MAX_CARRIED_DEPTH} directories below ${reportedDirPath}: a skill directory is walked to that depth only. A symbolic link that reaches a large tree is the usual cause.`,
      );
    }
    if (truncations.has("count")) {
      warnOnceWithFallback(
        undefined,
        `Not carrying the entries under ${reportedDirPath} beyond the first ${MAX_CARRIED_FILES}: a directory may carry at most that many files. A symbolic link that reaches a large tree is the usual cause.`,
      );
    }
    if (truncations.has("directories")) {
      warnOnceWithFallback(
        undefined,
        `Not carrying the entries under ${reportedDirPath} below the first ${MAX_CARRIED_DIRECTORIES} directories: a directory may carry files from at most that many directories. A symbolic link that reaches a large tree is the usual cause.`,
      );
    }
    if (truncations.has("entries")) {
      warnOnceWithFallback(
        undefined,
        `Not carrying the entries under ${reportedDirPath} that come after the first ${MAX_CARRIED_ENTRIES_EXAMINED} looked at: a directory is walked over at most that many entries. A tree of symbolic links that lead back into it is the usual cause.`,
      );
    }
    if (unreadablePaths.length > 0) {
      const { count, list } = formatReportedPaths(unreadablePaths);
      warnOnceWithFallback(
        undefined,
        `Not carrying ${count} ${entryWord(count)} that could not be read: ${list}. A permission the current user does not hold is the usual cause.`,
      );
    }
  }

  /**
   * Walk the directory once more with the hidden routes pruned, and take the
   * files the first walk had to leave behind because the route that reached
   * them ran through a hidden directory. This can only add files, and only ones
   * a fully named route reaches.
   */
  private static async recoverCarriedFilesFromNamedRoutes({
    dirPath,
    carried,
    carriedPaths,
    carriedRealPaths,
    truncations,
  }: {
    dirPath: string;
    carried: CarriedFilterResult;
    carriedPaths: string[];
    carriedRealPaths: Set<string>;
    truncations: Set<CarriedWalkTruncation>;
  }): Promise<void> {
    const named = await walkCarriedFiles(dirPath, { skipHiddenRoutes: true });
    const recovered = await AiDir.filterCarriedFiles(dirPath, named.filePaths);
    for (const filePath of recovered.filePaths) {
      const realFilePath = recovered.realFilePathByPath.get(filePath) ?? filePath;
      if (carriedRealPaths.has(realFilePath)) {
        continue;
      }
      if (carriedPaths.length >= MAX_CARRIED_FILES) {
        truncations.add("count");
        break;
      }
      carriedRealPaths.add(realFilePath);
      carriedPaths.push(filePath);
      if (recovered.carriedFromOutside.has(filePath)) {
        carried.carriedFromOutside.add(filePath);
      }
    }
    // A file the named route carried is not a file the skill is missing.
    for (const filePath of carried.refusedEscapedHidden) {
      const realFilePath = carried.realFilePathByPath.get(filePath) ?? filePath;
      if (carriedRealPaths.has(realFilePath)) {
        carried.refusedEscapedHidden.delete(filePath);
      }
    }
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
   * The walk is bounded and cycle-aware — see `walkCarriedFiles` — because the
   * tree may contain symbolic links that somebody else chose.
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
    const {
      filePaths: discoveredPaths,
      truncations,
      unreadablePaths,
      pseudoPaths,
    } = await walkCarriedFiles(dirPath);
    const reportedDirPath = stripControlCharacters(toPosixPath(dirPath));
    AiDir.warnOnCarriedWalkLimits({ reportedDirPath, truncations, unreadablePaths });
    await AiDir.warnOnNestedGitDirectory(dirPath);
    const carried = await AiDir.filterCarriedFiles(dirPath, discoveredPaths);
    const carriedPaths = [...carried.filePaths];
    const carriedRealPaths = new Set(
      carriedPaths.map((filePath) => carried.realFilePathByPath.get(filePath) ?? filePath),
    );

    // A directory is walked by one route only, and the route that claimed it may
    // be one the hidden-entry rule then refuses -- a link inside a hidden
    // directory, say -- while a fully named route to the same tree exists a
    // little further out. Rather than let the walk order decide a rule it cannot
    // see, walk once more with the hidden routes pruned and take what the first
    // pass had to leave behind. This can only add files, and only ones a named
    // route reaches.
    if (carried.refusedEscapedHidden.size > 0) {
      await AiDir.recoverCarriedFilesFromNamedRoutes({
        dirPath,
        carried,
        carriedPaths,
        carriedRealPaths,
        truncations,
      });
    }

    for (const pseudoPath of pseudoPaths) {
      carried.refusedPseudoPaths.add(pseudoPath);
    }
    AiDir.warnOnRefusedCarriedFiles(dirPath, carried);
    const filteredPaths = carriedPaths
      .toSorted()
      .filter((filePath) => basename(filePath) !== excludeFileName);

    // Read one at a time, and measure each file before reading it: a running
    // total checked after the fact is a total that has already been read into
    // memory, and one link to a multi-gigabyte file is enough.
    const files: AiDirFile[] = [];
    let carriedBytes = 0;
    for (const [index, filePath] of filteredPaths.entries()) {
      // Read the path the filter resolved and judged, not the one it started
      // from, and hold it open across the measurement and the read. Measuring a
      // name, then opening that name again, decides on one file and reads
      // another if the link moved in between -- long enough for `--watch` or a
      // script the skill itself runs to swap a benign target for a private key.
      const classifiedPath = carried.realFilePathByPath.get(filePath) ?? filePath;
      let fileHandle: FileHandle;
      try {
        // `O_NOFOLLOW`: the classified path is already fully resolved, so it is
        // a link only if one was put there since.
        fileHandle = await open(classifiedPath, constants.O_RDONLY | (constants.O_NOFOLLOW ?? 0));
      } catch (error) {
        warnOnceWithFallback(
          undefined,
          `Not carrying ${stripControlCharacters(toPosixPath(filePath))}: ${stripControlCharacters(formatError(error))}.`,
        );
        continue;
      }
      try {
        const fileSize = (await fileHandle.stat()).size;
        if (carriedBytes + fileSize > MAX_CARRIED_BYTES) {
          warnOnceWithFallback(
            undefined,
            `Not carrying ${filteredPaths.length - index} of the ${filteredPaths.length} entries under ${reportedDirPath}: a directory may carry at most ${MAX_CARRIED_BYTES / 1024 / 1024}MB. A symbolic link that reaches a large tree is the usual cause.`,
          );
          break;
        }
        const fileBuffer = await fileHandle.readFile();
        carriedBytes += fileBuffer.byteLength;
        files.push({
          relativeFilePathToDirPath: relative(dirPath, filePath),
          fileBuffer,
        });
      } catch (error) {
        // A file that opened but would not read -- a permission dropped in
        // between, or a device that refuses a plain read -- is skipped rather
        // than allowed to abort the whole directory.
        warnOnceWithFallback(
          undefined,
          `Not carrying ${stripControlCharacters(toPosixPath(filePath))}: ${stripControlCharacters(formatError(error))}.`,
        );
      } finally {
        await fileHandle.close();
      }
    }

    return files;
  }

  abstract validate(): ValidationResult;
}
