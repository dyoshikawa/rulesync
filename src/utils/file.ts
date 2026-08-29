import type { Stats } from "node:fs";
import {
  chmod,
  cp,
  lstat,
  mkdir,
  mkdtemp,
  readdir,
  readFile,
  realpath,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve, sep } from "node:path";

import { kebabCase } from "es-toolkit";
import { globbySync, isGitIgnoredSync } from "globby";

import { mapWithConcurrency } from "./concurrency.js";
import { stripControlCharacters } from "./control-characters.js";
import { formatError } from "./error.js";
import { isEnvTest } from "./vitest.js";

/**
 * Whether a relative path leads out of the root it is relative to. Matching
 * whole segments matters: a directory really named `..cache` relatively
 * resolves to `..cache/file`, which a prefix test would report as an escape.
 */
export function pathEscapesRoot(relativePath: string): boolean {
  return relativePath === ".." || relativePath.startsWith(`..${sep}`) || isAbsolute(relativePath);
}

/** Whether a single path segment is a hidden (dot-prefixed) name. */
export function isHiddenPathSegment(segment: string): boolean {
  return segment.startsWith(".") && segment !== "." && segment !== "..";
}

/** Split a path on both separators, so one predicate serves either platform. */
export function splitPathSegments(filePath: string): string[] {
  return filePath.split(/[/\\]/);
}

export async function assertWritablePathInsideRoot(params: {
  rootPath: string;
  targetPath: string;
}): Promise<void> {
  const { rootPath, targetPath } = params;
  let existingPath = targetPath;
  while (true) {
    try {
      const stats = await lstat(existingPath);
      if (resolve(existingPath) !== resolve(rootPath) && stats.isSymbolicLink()) {
        throw new Error(`Refusing to write through a symbolic link: ${targetPath}.`);
      }
      const relativeRealPath = relative(await realpath(rootPath), await realpath(existingPath));
      if (pathEscapesRoot(relativeRealPath)) {
        throw new Error(`Writable path must resolve inside the root: ${targetPath}.`);
      }
      return;
    } catch (error) {
      if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
        throw error;
      }
      const parentPath = dirname(existingPath);
      if (parentPath === existingPath) {
        throw error;
      }
      existingPath = parentPath;
    }
  }
}

export async function assertTreeContainsNoSymlinks(dirPath: string): Promise<void> {
  for (const entry of await readdir(dirPath, { withFileTypes: true })) {
    const entryPath = join(dirPath, entry.name);
    if (entry.isSymbolicLink()) {
      throw new Error(`Refusing to write into a tree containing a symbolic link: ${entryPath}.`);
    }
    if (entry.isDirectory()) {
      await assertTreeContainsNoSymlinks(entryPath);
    }
  }
}

export async function assertDirectoryIfExists(dirPath: string): Promise<void> {
  try {
    if (!(await lstat(dirPath)).isDirectory()) {
      throw new Error(`Expected a directory at writable path: ${dirPath}.`);
    }
  } catch (error) {
    if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
      throw error;
    }
  }
}

export async function runWithDirectoryRollback<T>(params: {
  directoryPaths: string[];
  action: () => Promise<T>;
}): Promise<T> {
  if (
    params.directoryPaths.some(
      (directoryPath) => !isAbsolute(directoryPath) || dirname(directoryPath) === directoryPath,
    )
  ) {
    throw new Error("Rollback directories must be absolute non-root paths.");
  }
  const backupRoot = await createTempDirectory("rulesync-rollback-");
  const snapshots: Array<{ directoryPath: string; backupPath: string; existed: boolean }> = [];
  let removeBackup = true;
  try {
    for (const [index, directoryPath] of params.directoryPaths.entries()) {
      const backupPath = join(backupRoot, String(index));
      let existed = false;
      try {
        const stats = await lstat(directoryPath);
        if (!stats.isDirectory()) {
          throw new Error(`Expected a directory at rollback path: ${directoryPath}.`);
        }
        await cp(directoryPath, backupPath, { recursive: true });
        existed = true;
      } catch (error) {
        if (!(error instanceof Error && "code" in error && error.code === "ENOENT")) {
          throw error;
        }
      }
      snapshots.push({ directoryPath, backupPath, existed });
    }
    return await params.action();
  } catch (error) {
    try {
      for (const snapshot of snapshots) {
        await rm(snapshot.directoryPath, { recursive: true, force: true });
        if (snapshot.existed) {
          await cp(snapshot.backupPath, snapshot.directoryPath, { recursive: true });
        }
      }
    } catch (rollbackError) {
      removeBackup = false;
      // oxlint-disable-next-line preserve-caught-error -- AggregateError retains both failures.
      throw new AggregateError(
        [error, rollbackError],
        `Action and directory rollback both failed. Backup preserved at ${backupRoot}.`,
        { cause: error },
      );
    }
    throw error;
  } finally {
    if (removeBackup) {
      await removeTempDirectory(backupRoot);
    }
  }
}

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await stat(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Drop paths that sit inside a directory the project's git ignore rules exclude.
 *
 * Deliberately tests the **directories** above each file rather than the file
 * itself. A project that ran `rulesync gitignore` has patterns for rulesync's
 * own outputs — `**\/AGENTS.md` among them — so a file-level test would exclude
 * every match and quietly disable the scan. What this is for is skipping
 * vendored and generated *trees*: content the project deliberately does not
 * track, which must not be copied into version-controlled rulesync sources.
 *
 * Ignore rules come from the `.gitignore` files at and below `rootDir`; a parent
 * repository's rules are not consulted, so running against a subdirectory of a
 * repository only sees that subdirectory's own rules.
 */
export function filterOutPathsInGitIgnoredDirectories({
  rootDir,
  filePaths,
}: {
  rootDir: string;
  filePaths: string[];
}): string[] {
  if (filePaths.length === 0) {
    // Building the matcher scans the tree for `.gitignore` files, which is not
    // worth doing when there is nothing to filter.
    return filePaths;
  }

  const isIgnored = isGitIgnoredSync({ cwd: rootDir });
  const resolvedRoot = resolve(rootDir);
  const cache = new Map<string, boolean>();

  const isInIgnoredDirectory = (directory: string): boolean => {
    const cached = cache.get(directory);
    if (cached !== undefined) {
      return cached;
    }
    const parent = dirname(directory);
    // Stop at `rootDir`, and at the filesystem root for a path that never
    // reaches it — `dirname("/")` is `"/"`, so walking up would not terminate.
    const ignored =
      directory !== resolvedRoot &&
      parent !== directory &&
      // The trailing slash is what makes a `vendored/` rule match the directory.
      (isIgnored(`${toPosixPath(directory)}/`) || isInIgnoredDirectory(parent));
    cache.set(directory, ignored);
    return ignored;
  };

  return filePaths.filter((filePath) => !isInIgnoredDirectory(dirname(resolve(filePath))));
}

/**
 * Converts OS-native path separators to POSIX forward slashes.
 * Use this instead of `path.posix.join` when input segments may already
 * contain backslashes (e.g., on Windows), because `path.posix.join` does
 * not normalize backslashes.
 */
export function toPosixPath(p: string): string {
  return p.replace(/\\/g, "/");
}

export function checkPathTraversal({
  relativePath,
  intendedRootDir,
}: {
  relativePath: string;
  intendedRootDir: string;
}): void {
  // Check for .. segments in the path (even if they don't escape the directory)
  const segments = relativePath.split(/[/\\]/);
  if (segments.includes("..")) {
    throw new Error(
      `Path traversal detected: ${JSON.stringify(stripControlCharacters(relativePath))}`,
    );
  }

  const resolved = resolve(intendedRootDir, relativePath);
  const rel = relative(intendedRootDir, resolved);
  if (rel.startsWith("..") || resolve(resolved) !== resolved) {
    throw new Error(
      `Path traversal detected: ${JSON.stringify(stripControlCharacters(relativePath))}`,
    );
  }
}

/**
 * Resolves a path relative to a base directory, handling both absolute and relative paths
 * Includes protection against path traversal attacks
 */
export function resolvePath(relativePath: string, outputRoot?: string): string {
  if (!outputRoot) return relativePath;

  checkPathTraversal({ relativePath, intendedRootDir: outputRoot });

  return resolve(outputRoot, relativePath);
}

/**
 * Creates a path resolver function bound to a specific base directory
 */
export function createPathResolver(outputRoot?: string) {
  return (relativePath: string) => resolvePath(relativePath, outputRoot);
}

/**
 * Safely reads a JSON file with error handling and optional default value
 */
export async function readJsonFile<T = unknown>(filepath: string, defaultValue?: T): Promise<T> {
  try {
    const content = await readFileContent(filepath);
    const parsed: T = JSON.parse(content);
    return parsed;
  } catch (error) {
    if (defaultValue !== undefined) {
      return defaultValue;
    }
    throw error;
  }
}

/**
 * Writes an object to a JSON file with proper formatting
 */
export async function writeJsonFile(
  filepath: string,
  data: unknown,
  indent: number = 2,
): Promise<void> {
  const content = JSON.stringify(data, null, indent);
  await writeFileContent(filepath, content);
}

/**
 * Checks if a directory exists and is actually a directory
 */
export async function directoryExists(dirPath: string): Promise<boolean> {
  try {
    const stats = await stat(dirPath);
    return stats.isDirectory();
  } catch {
    return false;
  }
}

export async function readFileContent(filepath: string): Promise<string> {
  return readFile(filepath, "utf-8");
}

/**
 * Read file content if it exists, otherwise return null.
 */
export async function readFileContentOrNull(filepath: string): Promise<string | null> {
  if (await fileExists(filepath)) {
    return readFileContent(filepath);
  }
  return null;
}

export async function readFileBuffer(filepath: string): Promise<Buffer> {
  return readFile(filepath);
}

/**
 * Read file as a buffer if it exists, otherwise return null.
 */
export async function readFileBufferOrNull(filepath: string): Promise<Buffer | null> {
  if (await fileExists(filepath)) {
    return readFileBuffer(filepath);
  }
  return null;
}

/**
 * Normalizes text to LF line endings and adds exactly one trailing newline.
 * Removes any existing trailing whitespace and appends a single newline.
 */
export function addTrailingNewline(content: string): string {
  if (!content) {
    return "\n";
  }

  return content.replaceAll("\r\n", "\n").replaceAll("\r", "\n").trimEnd() + "\n";
}

export async function writeFileContent(filepath: string, content: string): Promise<void> {
  await ensureDir(dirname(filepath));
  await writeFile(filepath, content, "utf-8");
}

/**
 * Apply a POSIX mode to an existing file. Windows has no executable bit and
 * `chmod` there only toggles the read-only flag, so the call is skipped rather
 * than writing a mode the platform cannot honor.
 */
export async function applyFileMode(filepath: string, mode: number): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  await chmod(filepath, mode);
}

/**
 * Restore an executable bit that went missing (interrupted run, a copy that
 * dropped the mode). A file whose mode is merely stricter than `mode` — the
 * user chose 0700 over 0755 — is left alone.
 */
export async function restoreMissingExecutableBit(filepath: string, mode: number): Promise<void> {
  if (process.platform === "win32") {
    return;
  }
  try {
    const current = (await stat(filepath)).mode;
    if ((current & 0o111) !== 0) {
      return;
    }
  } catch {
    return;
  }
  await chmod(filepath, mode);
}

export async function writeFileBuffer(filepath: string, buffer: Buffer): Promise<void> {
  await ensureDir(dirname(filepath));
  await writeFile(filepath, buffer);
}

/**
 * Whether an error means the path simply does not exist.
 *
 * Loading a `.rulesync/` source treats an absent file as "this feature has no
 * source here", which is ordinary; every other failure means the file is there
 * but could not be read or parsed. The `cause` chain is followed so a wrapped
 * error is still recognized.
 */
function someErrorInChain(error: unknown, predicate: (candidate: Error) => boolean): boolean {
  // A `cause` may point back at an error already visited (nothing forbids a
  // cycle), so walking the chain has to keep track of where it has been.
  const seen = new Set<unknown>();
  let current: unknown = error;
  while (current instanceof Error && !seen.has(current)) {
    if (predicate(current)) {
      return true;
    }
    seen.add(current);
    current = current.cause;
  }
  return false;
}

export function isFileNotFoundError(error: unknown): boolean {
  return someErrorInChain(error, (candidate) => "code" in candidate && candidate.code === "ENOENT");
}

/**
 * `errno` codes are the whole alphabet-soup family, so they are recognized by
 * shape rather than enumerated: any new one a future Node release surfaces has
 * to be treated as an I/O failure too.
 */
const ERRNO_CODE_PATTERN = /^E[A-Z0-9]+$/;

/**
 * Whether the failure came from the filesystem rather than from making sense of
 * what was read.
 *
 * A loader that deliberately skips a file it cannot parse still has to stop for
 * one it could not read at all. "This Markdown is not a subagent" is a decision
 * about that one file; "this entry is there and unreadable" says nothing about
 * what the source holds, so skipping it lets `--delete` remove output the run
 * was never able to regenerate.
 */
export function isFileSystemError(error: unknown): boolean {
  return someErrorInChain(
    error,
    (candidate) =>
      "code" in candidate &&
      typeof candidate.code === "string" &&
      ERRNO_CODE_PATTERN.test(candidate.code),
  );
}

/**
 * `stat` the path, separating plain absence from every other outcome.
 *
 * Answers `undefined` only when nothing is there at all. {@link fileExists} and
 * {@link directoryExists} answer `false` for every `stat` failure, so a path
 * that is present but cannot be examined — a symlink loop, a directory the
 * process may not traverse — is indistinguishable from one that was never
 * there. When absence is what decides whether a failure is reported, that
 * difference matters: mistaking an unreadable source for a missing one silently
 * drops the rules it was supposed to contain.
 */
async function statStrict(path: string): Promise<Stats | undefined> {
  try {
    return await stat(path);
  } catch (error) {
    if (!isFileNotFoundError(error)) {
      throw error;
    }

    // `stat` follows symlinks, so a link whose target is gone reports ENOENT
    // even though the entry itself is right there. Answering "absent" for it
    // would silently drop a source that the docs actively encourage pointing
    // at a shared tree by symlink — exactly the case where the target can go
    // missing. `lstat` looks at the link itself and settles which it is.
    try {
      await lstat(path);
    } catch {
      return undefined;
    }

    throw new Error(`${path} is a symbolic link whose target does not exist.`, {
      cause: error,
    });
  }
}

/**
 * Whether something is at the path but cannot be resolved.
 *
 * `stat` follows symlinks, so a link into a tree that has been moved away
 * answers `false` from both {@link fileExists} and {@link directoryExists} —
 * the same answer as a path that was never configured. `lstat` looks at the
 * entry itself, which is what separates "there is nothing here" from "there is
 * something here that leads nowhere".
 */
export async function isPresentButUnresolvable(path: string): Promise<boolean> {
  try {
    await stat(path);
    return false;
  } catch {
    try {
      await lstat(path);
      return true;
    } catch {
      return false;
    }
  }
}

/**
 * Whether the path exists, treating any failure other than "it does not exist"
 * as an error rather than as absence.
 */
export async function fileExistsStrict(filepath: string): Promise<boolean> {
  return (await statStrict(filepath)) !== undefined;
}

/**
 * Whether the directory exists, treating anything other than plain absence as
 * an error — the {@link fileExistsStrict} contract, for a directory.
 *
 * A source-tree directory that is a symbolic link into a shared tree is a
 * documented layout, and a checkout where that tree is missing answers `false`
 * from {@link directoryExists}. The feature then loads no sources at all, which
 * reads as "there is nothing here" and lets `--delete` sweep away the configs
 * the run could not regenerate. A path occupied by something that is not a
 * directory is reported for the same reason: it is a misconfiguration, not an
 * empty source tree.
 */
export async function directoryExistsStrict(dirPath: string): Promise<boolean> {
  const stats = await statStrict(dirPath);

  if (stats === undefined) {
    return false;
  }

  if (!stats.isDirectory()) {
    throw new Error(`${dirPath} exists but is not a directory.`);
  }

  return true;
}

export async function fileExists(filepath: string): Promise<boolean> {
  try {
    await stat(filepath);
    return true;
  } catch {
    return false;
  }
}

export async function getFileSize(filepath: string): Promise<number> {
  try {
    const stats = await stat(filepath);
    return stats.size;
  } catch (error) {
    throw new Error(`Failed to get file size for "${filepath}": ${formatError(error)}`, {
      cause: error,
    });
  }
}

export async function isSymlink(filepath: string): Promise<boolean> {
  try {
    const stats = await lstat(filepath);
    return stats.isSymbolicLink();
  } catch {
    return false;
  }
}

export async function listDirectoryFiles(dir: string): Promise<string[]> {
  try {
    return await readdir(dir);
  } catch {
    return [];
  }
}

export async function findFiles(dir: string, extension: string = ".md"): Promise<string[]> {
  try {
    const files = await readdir(dir);
    return files.filter((file) => file.endsWith(extension)).map((file) => join(dir, file));
  } catch {
    return [];
  }
}

/** How many dot-prefixed segments a path has, used to prefer a named alias over a hidden one. */
function countHiddenSegments(filePath: string): number {
  return splitPathSegments(filePath).filter(isHiddenPathSegment).length;
}

/**
 * The real file a path denotes, posix-separated so it compares against the globby results
 * that produce it. Two paths share an identity when they resolve to the very same file --
 * a link beside its target, a link into a shared tree, or a cycle that walks back into an
 * ancestor and yields the same file forty levels down.
 */
async function realFileIdentity(filePath: string): Promise<string> {
  try {
    return toPosixPath(await realpath(filePath));
  } catch {
    // realpath can fail on a broken link or a race; fall back to the literal path so the
    // entry still counts (and is still deduplicated against identical literals).
    return toPosixPath(filePath);
  }
}

/**
 * Pick the one path that represents a file among the paths that resolve to it.
 *
 * The path that walked through no link at all wins outright: it is already the real one,
 * so it equals the file's identity. That keeps the real location of a file as the path
 * callers see, rather than an alias that happens to sort first -- a directory link named
 * `aaa` pointing at `zzz` must not make `zzz/x.md` disappear, and a cycle must not replace
 * `sub/note.md` with the same file reached back through the cycle.
 * Failing that, the fewest dot-prefixed segments wins: when only links are on offer, the
 * named one represents the entry rather than a hidden alias that a hidden-entry rule may
 * then drop, taking the named path's content with it. `candidates` arrives in sorted
 * order, so ties keep the first one deterministically.
 */
function chooseRepresentative(candidates: string[], identity: string): string {
  return candidates.reduce((best, candidate) => {
    if (toPosixPath(best) === identity) {
      return best;
    }
    if (toPosixPath(candidate) === identity) {
      return candidate;
    }
    return countHiddenSegments(candidate) < countHiddenSegments(best) ? candidate : best;
  });
}

export async function findFilesByGlobs(
  globs: string | string[],
  options: {
    /** Directory in which relative patterns are evaluated. */
    cwd?: string;
    type?: "file" | "dir" | "all";
    followSymbolicLinks?: boolean;
    /**
     * Patterns to exclude, passed to globby's `ignore`. Prefer this over inline
     * `!` patterns: globby rewrites a negative pattern that contains no glob
     * metacharacter as cwd-relative, so an absolute `!/abs/path/file.md` silently
     * matches nothing.
     *
     * Match the form of the include patterns: when those are absolute, a
     * relative `ignore` such as `dist/**` silently excludes nothing. Either use
     * absolute ignore patterns or anchor them with a leading `**\/`.
     */
    ignore?: string[];
    /**
     * Include dot-prefixed files and directories, passed to globby's `dot`.
     * Off by default because discovery globs look for named config files, and a
     * hidden entry is far more likely to be editor or VCS noise than something
     * a tool reads. Turn it on where the contract is "carry this tree as it is"
     * rather than "find these files".
     *
     * No caller does today: the one that did — a skill directory, whose
     * specification says it "may contain any files and directories beyond the
     * required `SKILL.md`" — now walks its own tree, because a glob walk cannot
     * bound what a symbolic link in somebody else's tree reaches. The option and
     * the entry de-duplication below stay for the next caller with that
     * contract; both are covered by tests.
     *
     * @see https://agentskills.io/specification
     */
    dot?: boolean;
  } = {},
): Promise<string[]> {
  const { type = "all", followSymbolicLinks = true, ignore, dot = false } = options;
  const globbyOptions =
    type === "file"
      ? { onlyFiles: true, onlyDirectories: false }
      : type === "dir"
        ? { onlyFiles: false, onlyDirectories: true }
        : { onlyFiles: false, onlyDirectories: false };
  // Normalize glob patterns to use forward slashes (required for globby on Windows)
  const normalizedGlobs = Array.isArray(globs)
    ? globs.map((g) => g.replaceAll("\\", "/"))
    : globs.replaceAll("\\", "/");
  // Symlink following defaults to true so callers can share skills/rules without
  // duplication (see issue #1707). Destructive discovery passes false and validates
  // real-path containment before deletion. Untrusted remote content is a separate code
  // path: git-client.ts (`walkDirectory`) skips symlinks entirely.
  const results = globbySync(normalizedGlobs, {
    absolute: true,
    ...(options.cwd === undefined ? {} : { cwd: options.cwd }),
    followSymbolicLinks,
    dot,
    ...(ignore ? { ignore: ignore.map((pattern) => pattern.replaceAll("\\", "/")) } : {}),
    ...globbyOptions,
  });
  // Deduplicate by real file so that directory symlink cycles (which globby follows up to
  // the kernel ELOOP limit, ~40 levels) do not yield ~40x duplicated entries that would be
  // read and re-emitted -- and so that a thousand links to one file cost one read of it,
  // not a thousand. One path per file, chosen by `chooseRepresentative`.
  const candidatesByFile = new Map<string, string[]>();
  for (const result of results.toSorted()) {
    const identity = await realFileIdentity(result);
    const candidates = candidatesByFile.get(identity);
    if (candidates === undefined) {
      candidatesByFile.set(identity, [result]);
    } else {
      candidates.push(result);
    }
  }
  const representatives = [...candidatesByFile.entries()].map(([identity, candidates]) =>
    chooseRepresentative(candidates, identity),
  );
  return representatives.toSorted();
}

/** How many entries are read back from disk at once while classifying a directory. */
const ENTRY_CLASSIFY_CONCURRENCY = 32;

/** An entry of the requested kind, and whether the name reaches it through a link. */
type ClassifiedEntry = { name: string; isLink: boolean };

/**
 * The entry names of `dirPath` that are of `kind`, deduplicated and sorted.
 *
 * The shared implementation behind {@link listSubdirectoryNames} and
 * {@link listFileNames}; see the former for why these read the directory
 * rather than glob it.
 */
async function listEntryNames(params: {
  dirPath: string;
  kind: "dir" | "file";
  followSymbolicLinks: boolean;
  includeHidden: boolean;
  nameFilter: ((name: string) => boolean) | undefined;
}): Promise<string[]> {
  const { dirPath, kind, followSymbolicLinks, includeHidden, nameFilter } = params;
  const matches = (stats: { isDirectory: () => boolean; isFile: () => boolean }): boolean =>
    kind === "dir" ? stats.isDirectory() : stats.isFile();
  const entries = await readdir(dirPath, { withFileTypes: true });
  // Hidden entries are left out by default, matching the `dot: false` the glob
  // this replaced ran with. It is not cosmetic: the deletion sweep takes every
  // directory it is handed, so a `.git` or `.venv` beside the skills would be
  // removed by a change that only meant to spell names correctly.
  // The caller's filter runs here rather than on the result, so a name it does
  // not want cannot become the representative of an entry a wanted name also
  // reaches — which would drop that entry from the listing entirely.
  const wanted =
    nameFilter === undefined ? entries : entries.filter((entry) => nameFilter(entry.name));
  const visible = includeHidden
    ? wanted
    : wanted.filter((entry) => !isHiddenPathSegment(entry.name));
  const classified = await mapWithConcurrency({
    items: visible,
    limit: ENTRY_CLASSIFY_CONCURRENCY,
    mapper: async (entry): Promise<ClassifiedEntry | undefined> => {
      if (matches(entry)) {
        return { name: entry.name, isLink: false };
      }
      if (entry.isDirectory() || entry.isFile()) {
        return undefined;
      }
      // `readdir` reports a link as a link and never as what it stands for, so
      // a link is the one entry kind that needs a second look. An entry of no
      // kind at all needs the same one: a filesystem that does not fill the
      // entry type in (some network and FUSE mounts) reports every predicate as
      // false, and taking that at face value would empty the directory.
      const entryPath = join(dirPath, entry.name);
      const entryStats = entry.isSymbolicLink()
        ? undefined
        : await lstat(entryPath).catch(() => undefined);
      const isLink = entry.isSymbolicLink() || (entryStats?.isSymbolicLink() ?? false);
      if (!isLink) {
        return entryStats !== undefined && matches(entryStats)
          ? { name: entry.name, isLink: false }
          : undefined;
      }
      if (!followSymbolicLinks) {
        return undefined;
      }
      // A link that leads nowhere is not an entry to report.
      const target = await stat(entryPath).catch(() => undefined);
      return target !== undefined && matches(target)
        ? { name: entry.name, isLink: true }
        : undefined;
    },
  });
  const found = classified
    .filter((entry) => entry !== undefined)
    // Sorted for the same reason `findFilesByGlobs` sorts: the order entries
    // come off the filesystem in is not one a caller should have to depend on.
    .toSorted((left, right) => (left.name < right.name ? -1 : left.name > right.name ? 1 : 0));
  if (!found.some((entry) => entry.isLink)) {
    return found.map((entry) => entry.name);
  }
  return await dedupeNamesByFileIdentity({ dirPath, entries: found });
}

/**
 * Collapse the names that lead to one and the same entry onto a single name.
 *
 * `findFilesByGlobs` does this for the paths it returns, and dropping it here
 * would change what a caller sees: a directory link named `aaa` beside the
 * directory `zzz` it stands for is one skill, and reporting both would import
 * it twice. The name that reaches the entry directly wins, for the reason
 * spelled out in {@link chooseRepresentative} — but decided from the entry
 * itself rather than by comparing paths, since the path a caller passes in may
 * be relative or lead through a link of its own, and neither spelling equals
 * the real path `realpath` returns. `entries` arrives sorted, so ties are
 * stable.
 */
async function dedupeNamesByFileIdentity(params: {
  dirPath: string;
  entries: readonly ClassifiedEntry[];
}): Promise<string[]> {
  const { dirPath, entries } = params;
  const identities = await mapWithConcurrency({
    items: entries,
    limit: ENTRY_CLASSIFY_CONCURRENCY,
    mapper: async (entry) => await realFileIdentity(join(dirPath, entry.name)),
  });
  const entriesByIdentity = new Map<string, ClassifiedEntry[]>();
  for (const [index, entry] of entries.entries()) {
    // `realFileIdentity` falls back to the literal path rather than failing, so
    // an entry whose identity cannot be read stands on its own here instead of
    // dropping out of the listing.
    const identity = identities[index] ?? toPosixPath(join(dirPath, entry.name));
    const group = entriesByIdentity.get(identity);
    if (group === undefined) {
      entriesByIdentity.set(identity, [entry]);
    } else {
      group.push(entry);
    }
  }
  const representatives = [...entriesByIdentity.values()].map(
    (group) =>
      group.reduce((best, candidate) => {
        if (!best.isLink) {
          return best;
        }
        if (!candidate.isLink) {
          return candidate;
        }
        // Only links left: the named one represents the entry rather than a
        // hidden alias, which a hidden-entry rule may then drop.
        return isHiddenPathSegment(best.name) && !isHiddenPathSegment(candidate.name)
          ? candidate
          : best;
      }).name,
  );
  return representatives.toSorted();
}

/**
 * The immediate subdirectory names of `dirPath`, spelled the way the filesystem
 * spells them.
 *
 * A `*` glob cannot stand in for this. Globby reads a backslash as a path
 * separator, so a directory literally named `back\\slash` comes back as
 * `.../back/slash`, and the name recovered from that — `slash` — belongs to a
 * directory that does not exist. Whatever the caller does next with the name
 * then quietly misses the real directory: loading it, or sweeping it as an
 * orphan. Windows is not affected, since a backslash cannot appear in a name
 * there, which is what makes the glob look correct everywhere it is tested.
 *
 * Rejects if the directory cannot be read, so a root that is there but
 * unreadable is never mistaken for an empty one.
 *
 * `nameFilter` narrows the listing while it is read rather than afterwards; see
 * {@link listEntryNames} for why the difference matters.
 */
export async function listSubdirectoryNames(
  dirPath: string,
  options: {
    followSymbolicLinks?: boolean;
    includeHidden?: boolean;
    nameFilter?: (name: string) => boolean;
  } = {},
): Promise<string[]> {
  return await listEntryNames({
    dirPath,
    kind: "dir",
    followSymbolicLinks: options.followSymbolicLinks ?? true,
    includeHidden: options.includeHidden ?? false,
    nameFilter: options.nameFilter,
  });
}

/**
 * The immediate file names of `dirPath`, spelled the way the filesystem spells
 * them. The counterpart of {@link listSubdirectoryNames}, and the same reason
 * to prefer it over a `*` glob applies.
 */
export async function listFileNames(
  dirPath: string,
  options: {
    followSymbolicLinks?: boolean;
    includeHidden?: boolean;
    nameFilter?: (name: string) => boolean;
  } = {},
): Promise<string[]> {
  return await listEntryNames({
    dirPath,
    kind: "file",
    followSymbolicLinks: options.followSymbolicLinks ?? true,
    includeHidden: options.includeHidden ?? false,
    nameFilter: options.nameFilter,
  });
}

export async function findRuleFiles(aiRulesDir: string): Promise<string[]> {
  const rulesDir = join(aiRulesDir, "rules");
  return findFiles(rulesDir, ".md");
}

export async function removeDirectory(dirPath: string): Promise<void> {
  // Safety check: prevent deletion of dangerous paths
  const dangerousPaths = [".", "/", "~", "src", "node_modules"];
  if (dangerousPaths.includes(dirPath) || dirPath === "") {
    return;
  }

  try {
    if (await fileExists(dirPath)) {
      await rm(dirPath, { recursive: true, force: true });
    }
  } catch {
    // Best-effort removal; silently ignore errors
  }
}

export async function removeDirectoryStrict(dirPath: string): Promise<void> {
  if (!isAbsolute(dirPath) || dirname(dirPath) === dirPath) {
    throw new Error(`Strict directory removal requires an absolute non-root path: ${dirPath}.`);
  }
  await rm(dirPath, { recursive: true, force: true });
}

export async function removeFile(filepath: string): Promise<void> {
  try {
    if (await fileExists(filepath)) {
      await rm(filepath);
    }
  } catch {
    // Best-effort removal; silently ignore errors
  }
}

export async function removeFileStrict(filePath: string): Promise<void> {
  if (!isAbsolute(filePath) || dirname(filePath) === filePath) {
    throw new Error(`Strict file removal requires an absolute non-root path: ${filePath}.`);
  }
  await rm(filePath, { force: true });
}

export function getHomeDirectory(): string {
  const homeDirFromEnv = process.env.HOME_DIR;
  if (homeDirFromEnv) {
    return homeDirFromEnv;
  }

  if (isEnvTest()) {
    throw new Error(
      "getHomeDirectory() must be mocked in test environment, or set HOME_DIR environment variable",
    );
  }

  return os.homedir();
}

/**
 * Validates that a outputRoot is safe to use as the source/output root.
 *
 * Contract:
 * - Rejects empty strings.
 * - For absolute paths: requires the path to already be normalized (i.e.
 *   `resolve(outputRoot) === outputRoot`). This rejects sneaky inputs like
 *   `/foo/../bar` and forces callers to pass an explicit, normalized intent.
 *   Also rejects the filesystem root (`/` on POSIX, `C:\\` etc. on Windows)
 *   because that is almost certainly a misconfiguration, not a real source
 *   directory.
 * - For relative paths: applies `checkPathTraversal` against the current
 *   working directory. Benign no-op shortcuts like `.`, `./`, and `.\\` are
 *   accepted because they don't escape cwd; resolver paths typically pre-
 *   resolve to absolute first, so the relative branch mostly serves direct
 *   programmatic callers.
 *
 * Note: callers that need to validate a path while in a different "intended
 * root" should resolve it to absolute first and then pass it here, or use
 * `checkPathTraversal` directly with the appropriate `intendedRootDir`.
 *
 * @throws {Error} if the outputRoot is dangerous, unnormalized, or the
 * filesystem root.
 */
export function validateOutputRoot(outputRoot: string): void {
  // Reject empty strings
  if (outputRoot.trim() === "") {
    throw new Error("outputRoot cannot be an empty string");
  }

  if (isAbsolute(outputRoot)) {
    // Defense-in-depth: split on path separators and reject any `..` segment.
    // The separator set is platform-aware because POSIX paths can legitimately
    // contain a literal backslash inside a filename component (e.g.
    // `/srv/foo\bar`), and treating `\` as a separator there would falsely
    // split such filenames. On Windows, both `/` and `\` are valid path
    // separators (Windows `resolve()` ignores `/` in some legacy paths), so
    // we keep the dual-separator split there to catch cross-platform inputs
    // like `C:/foo\..\bar` that would otherwise slip past the
    // normalized-equality check below.
    const separatorRegex = process.platform === "win32" ? /[/\\]/ : /\//;
    const segments = outputRoot.split(separatorRegex);
    if (segments.includes("..")) {
      throw new Error(`Path traversal detected: ${stripControlCharacters(outputRoot)}`);
    }

    // Reject unnormalized absolute paths. After `resolve(outputRoot)` collapses
    // any `.`/`..` segments and normalizes separators, the result must equal
    // the input — otherwise the caller passed a path that hides traversal
    // intent inside an absolute prefix (e.g. `/foo/./bar` or `/foo//bar`).
    const normalized = resolve(outputRoot);
    if (normalized !== outputRoot) {
      throw new Error(
        `outputRoot must be a normalized absolute path: ${stripControlCharacters(outputRoot)} ` +
          `(normalized: ${stripControlCharacters(normalized)})`,
      );
    }

    // Reject the filesystem root explicitly. `dirname(root) === root` is the
    // standard cross-platform way to detect the root of the volume.
    if (dirname(normalized) === normalized) {
      throw new Error(
        `outputRoot must not be the filesystem root: ${stripControlCharacters(outputRoot)}. ` +
          `Pass a specific project directory instead.`,
      );
    }
    return;
  }

  // Relative-path branch. `checkPathTraversal` rejects values that escape
  // `process.cwd()`, while allowing benign no-op shortcuts like `.` and `./`.
  // Those shortcuts are functionally equivalent to omitting the option and
  // have always been accepted by the resolver path (which `resolve()`s before
  // calling here), so we accept them in direct programmatic callers too to
  // avoid an accidental breaking change.
  checkPathTraversal({ relativePath: outputRoot, intendedRootDir: process.cwd() });
}

/**
 * Converts a filename to kebab-case format using es-toolkit.
 * Useful for tools like Antigravity that require lowercase filenames with hyphens.
 *
 * @param filename - The filename to convert (e.g., "MyFile.md")
 * @returns The kebab-cased filename (e.g., "my-file.md")
 *
 * @example
 * toKebabCaseFilename("CodingGuidelines.md") // "coding-guidelines.md"
 * toKebabCaseFilename("API_Reference.md") // "api-reference.md"
 */
export function toKebabCaseFilename(filename: string): string {
  // Extract extension
  const lastDotIndex = filename.lastIndexOf(".");
  const extension = lastDotIndex > 0 ? filename.slice(lastDotIndex) : "";
  const nameWithoutExt = lastDotIndex > 0 ? filename.slice(0, lastDotIndex) : filename;

  // Use es-toolkit's kebabCase for consistent conversion
  const kebabName = kebabCase(nameWithoutExt);

  return kebabName + extension;
}

/**
 * Create a temporary directory atomically and return its path.
 * Uses fs.mkdtemp() for secure atomic directory creation, preventing TOCTOU race conditions.
 *
 * @param prefix - Prefix for the temp directory name (default: "rulesync-fetch-")
 * @returns The full path to the created temporary directory
 */
export async function createTempDirectory(prefix = "rulesync-fetch-"): Promise<string> {
  return mkdtemp(join(os.tmpdir(), prefix));
}

/**
 * Remove a temporary directory and all its contents.
 * Silently ignores errors (e.g., directory doesn't exist).
 *
 * @param tempDir - Path to the temporary directory to remove
 */
export async function removeTempDirectory(tempDir: string): Promise<void> {
  try {
    await rm(tempDir, { recursive: true, force: true });
  } catch {
    // Best-effort cleanup; silently ignore errors
  }
}
