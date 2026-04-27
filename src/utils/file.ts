import { lstat, mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, isAbsolute, join, relative, resolve } from "node:path";

import { kebabCase } from "es-toolkit";
import { globbySync } from "globby";

import { formatError } from "./error.js";
import { isEnvTest } from "./vitest.js";

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await stat(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

export async function readOrInitializeFileContent(
  filePath: string,
  initialContent: string = "",
): Promise<string> {
  if (await fileExists(filePath)) {
    return await readFileContent(filePath);
  } else {
    await ensureDir(dirname(filePath));
    await writeFileContent(filePath, initialContent);
    return initialContent;
  }
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
    throw new Error(`Path traversal detected: ${relativePath}`);
  }

  const resolved = resolve(intendedRootDir, relativePath);
  const rel = relative(intendedRootDir, resolved);
  if (rel.startsWith("..") || resolve(resolved) !== resolved) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }
}

/**
 * Resolves a path relative to a base directory, handling both absolute and relative paths
 * Includes protection against path traversal attacks
 */
export function resolvePath(relativePath: string, baseDir?: string): string {
  if (!baseDir) return relativePath;

  checkPathTraversal({ relativePath, intendedRootDir: baseDir });

  return resolve(baseDir, relativePath);
}

/**
 * Creates a path resolver function bound to a specific base directory
 */
export function createPathResolver(baseDir?: string) {
  return (relativePath: string) => resolvePath(relativePath, baseDir);
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
 * Adds exactly one trailing newline to content.
 * Removes any existing trailing whitespace and appends a single newline.
 */
export function addTrailingNewline(content: string): string {
  if (!content) {
    return "\n";
  }

  return content.trimEnd() + "\n";
}

export async function writeFileContent(filepath: string, content: string): Promise<void> {
  await ensureDir(dirname(filepath));
  await writeFile(filepath, content, "utf-8");
}

export async function writeFileBuffer(filepath: string, buffer: Buffer): Promise<void> {
  await ensureDir(dirname(filepath));
  await writeFile(filepath, buffer);
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

export async function findFilesByGlobs(
  globs: string | string[],
  options: { type?: "file" | "dir" | "all" } = {},
): Promise<string[]> {
  const { type = "all" } = options;
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
  const results = globbySync(normalizedGlobs, {
    absolute: true,
    followSymbolicLinks: false,
    ...globbyOptions,
  });
  // Sort for consistent ordering across different glob implementations
  return results.toSorted();
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

export async function removeFile(filepath: string): Promise<void> {
  try {
    if (await fileExists(filepath)) {
      await rm(filepath);
    }
  } catch {
    // Best-effort removal; silently ignore errors
  }
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
 * Validates that a baseDir is safe to use as the source/output root.
 *
 * Contract:
 * - Rejects empty strings.
 * - For absolute paths: requires the path to already be normalized (i.e.
 *   `resolve(baseDir) === baseDir`). This rejects sneaky inputs like
 *   `/foo/../bar` and forces callers to pass an explicit, normalized intent.
 *   Also rejects the filesystem root (`/` on POSIX, `C:\\` etc. on Windows)
 *   because that is almost certainly a misconfiguration, not a real source
 *   directory.
 * - For relative paths: applies `checkPathTraversal` against the current
 *   working directory.
 *
 * Note: callers that need to validate a path while in a different "intended
 * root" should resolve it to absolute first and then pass it here, or use
 * `checkPathTraversal` directly with the appropriate `intendedRootDir`.
 *
 * @throws {Error} if the baseDir is dangerous, unnormalized, or the
 * filesystem root.
 */
export function validateBaseDir(baseDir: string): void {
  // Reject empty strings
  if (baseDir.trim() === "") {
    throw new Error("baseDir cannot be an empty string");
  }

  if (isAbsolute(baseDir)) {
    // Defense-in-depth: split on both POSIX and Windows separators and
    // reject any `..` segment. On POSIX, `resolve()` does not treat `\` as
    // a separator, so a Windows-style traversal like `/foo\..\bar` would
    // otherwise slip past the normalized-equality check below.
    const segments = baseDir.split(/[/\\]/);
    if (segments.includes("..")) {
      throw new Error(`Path traversal detected: ${baseDir}`);
    }

    // Reject unnormalized absolute paths. After `resolve(baseDir)` collapses
    // any `.`/`..` segments and normalizes separators, the result must equal
    // the input — otherwise the caller passed a path that hides traversal
    // intent inside an absolute prefix (e.g. `/foo/./bar` or `/foo//bar`).
    const normalized = resolve(baseDir);
    if (normalized !== baseDir) {
      throw new Error(
        `baseDir must be a normalized absolute path: ${baseDir} (normalized: ${normalized})`,
      );
    }

    // Reject the filesystem root explicitly. `dirname(root) === root` is the
    // standard cross-platform way to detect the root of the volume.
    if (dirname(normalized) === normalized) {
      throw new Error(
        `baseDir must not be the filesystem root: ${baseDir}. ` +
          `Pass a specific project directory instead.`,
      );
    }
    return;
  }

  checkPathTraversal({ relativePath: baseDir, intendedRootDir: process.cwd() });
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
