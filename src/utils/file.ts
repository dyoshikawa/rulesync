import { mkdir, mkdtemp, readdir, readFile, rm, stat, writeFile } from "node:fs/promises";
import { basename, dirname, join, relative, resolve } from "node:path";
import { logger } from "./logger.js";

export async function ensureDir(dirPath: string): Promise<void> {
  try {
    await stat(dirPath);
  } catch {
    await mkdir(dirPath, { recursive: true });
  }
}

/**
 * Resolves a path relative to a base directory, handling both absolute and relative paths
 * Includes protection against path traversal attacks
 */
export function resolvePath(relativePath: string, baseDir?: string): string {
  if (!baseDir) return relativePath;

  const resolved = resolve(baseDir, relativePath);
  const rel = relative(baseDir, resolved);

  // Prevent path traversal attacks
  if (rel.startsWith("..") || resolve(resolved) !== resolved) {
    throw new Error(`Path traversal detected: ${relativePath}`);
  }

  return resolved;
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

export async function writeFileContent(filepath: string, content: string): Promise<void> {
  logger.debug(`Writing file: ${filepath}`);

  await ensureDir(dirname(filepath));
  await writeFile(filepath, content, "utf-8");
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

/**
 * Finds rule files in both new (.rulesync/rules/*.md) and legacy (.rulesync/*.md) locations
 * with priority given to the new location. Files in both locations with the same name
 * are deduplicated with priority given to the new location.
 */
export async function findRuleFiles(aiRulesDir: string): Promise<string[]> {
  const rulesDir = join(aiRulesDir, "rules");
  const newLocationFiles = await findFiles(rulesDir, ".md");
  const legacyLocationFiles = await findFiles(aiRulesDir, ".md");

  // Get basenames from new location files for deduplication
  const newLocationBasenames = new Set(newLocationFiles.map((file) => basename(file, ".md")));

  // Filter legacy files to exclude those that exist in new location
  const filteredLegacyFiles = legacyLocationFiles.filter((file) => {
    const fileBasename = basename(file, ".md");
    return !newLocationBasenames.has(fileBasename);
  });

  // Return combined list with new location files first
  return [...newLocationFiles, ...filteredLegacyFiles];
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

export async function createTempDirectory(prefix: string): Promise<string> {
  return await mkdtemp(prefix);
}
