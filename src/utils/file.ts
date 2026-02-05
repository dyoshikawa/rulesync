import { kebabCase } from "es-toolkit";
import { globbySync } from "globby";
import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import os from "node:os";
import { dirname, join, relative, resolve } from "node:path";

import { logger } from "./logger.js";
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
  logger.debug(`Reading file: ${filepath}`);
  return readFile(filepath, "utf-8");
}

export async function readFileBuffer(filepath: string): Promise<Buffer> {
  logger.debug(`Reading file buffer: ${filepath}`);
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
  logger.debug(`Writing file: ${filepath}`);

  await ensureDir(dirname(filepath));
  await writeFile(filepath, content, "utf-8");
}

export async function writeFileBuffer(filepath: string, buffer: Buffer): Promise<void> {
  logger.debug(`Writing file buffer: ${filepath}`);

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
  const results = globbySync(normalizedGlobs, { absolute: true, ...globbyOptions });
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
    logger.warn(`Skipping deletion of dangerous path: ${dirPath}`);
    return;
  }

  try {
    if (await fileExists(dirPath)) {
      await rm(dirPath, { recursive: true, force: true });
    }
  } catch (error) {
    logger.warn(`Failed to remove directory ${dirPath}:`, error);
  }
}

export async function removeFile(filepath: string): Promise<void> {
  logger.debug(`Removing file: ${filepath}`);
  try {
    if (await fileExists(filepath)) {
      await rm(filepath);
    }
  } catch (error) {
    logger.warn(`Failed to remove file ${filepath}:`, error);
  }
}

export function getHomeDirectory(): string {
  if (isEnvTest) {
    throw new Error("getHomeDirectory() must be mocked in test environment");
  }

  return os.homedir();
}

/**
 * Validates that a baseDir is safe to use
 * @throws {Error} if the baseDir is dangerous or contains path traversal
 */
export function validateBaseDir(baseDir: string): void {
  // Reject empty strings
  if (baseDir.trim() === "") {
    throw new Error("baseDir cannot be an empty string");
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
    logger.debug(`Removed temp directory: ${tempDir}`);
  } catch {
    logger.debug(`Failed to clean up temp directory: ${tempDir}`);
  }
}
