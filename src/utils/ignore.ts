import { join } from "node:path";
import micromatch from "micromatch";
import { fileExists, readFileContent } from "./file.js";
import { logger } from "./logger.js";

interface IgnorePatterns {
  patterns: string[];
}

let cachedIgnorePatterns: IgnorePatterns | null = null;

export async function loadIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnorePatterns> {
  if (cachedIgnorePatterns) {
    return cachedIgnorePatterns;
  }

  const ignorePath = join(baseDir, ".rulesyncignore");

  if (!(await fileExists(ignorePath))) {
    cachedIgnorePatterns = { patterns: [] };
    return cachedIgnorePatterns;
  }

  try {
    const content = await readFileContent(ignorePath);
    const patterns = parseIgnoreFile(content);
    cachedIgnorePatterns = { patterns };
    return cachedIgnorePatterns;
  } catch (error) {
    logger.warn(`Failed to read .rulesyncignore: ${error}`);
    cachedIgnorePatterns = { patterns: [] };
    return cachedIgnorePatterns;
  }
}

export function parseIgnoreFile(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line.length > 0 && !line.startsWith("#"));
}

export function isFileIgnored(filepath: string, ignorePatterns: string[]): boolean {
  if (ignorePatterns.length === 0) {
    return false;
  }

  // Check for negation patterns
  const negationPatterns = ignorePatterns.filter((p) => p.startsWith("!"));
  const positivePatterns = ignorePatterns.filter((p) => !p.startsWith("!"));

  // First check if file matches any positive pattern
  const isIgnored =
    positivePatterns.length > 0 &&
    micromatch.isMatch(filepath, positivePatterns, {
      dot: true,
    });

  // If ignored, check if any negation pattern excludes it
  if (isIgnored && negationPatterns.length > 0) {
    const negationPatternsWithoutPrefix = negationPatterns.map((p) => p.substring(1));
    return !micromatch.isMatch(filepath, negationPatternsWithoutPrefix, {
      dot: true,
    });
  }

  return isIgnored;
}

export function filterIgnoredFiles(files: string[], ignorePatterns: string[]): string[] {
  if (ignorePatterns.length === 0) {
    return files;
  }

  return files.filter((file) => !isFileIgnored(file, ignorePatterns));
}

export function clearIgnoreCache(): void {
  cachedIgnorePatterns = null;
}
