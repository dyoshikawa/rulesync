import { getErrorMessage, safeAsyncOperation } from "../../utils/error.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import type { IgnoreParseResult } from "./base.js";

/**
 * Parse a gitignore-style file and return patterns
 */
export async function parseIgnoreFile(
  filePath: string,
  baseDir: string = process.cwd(),
): Promise<IgnoreParseResult> {
  const resolvedPath = resolvePath(filePath, baseDir);

  if (!(await fileExists(resolvedPath))) {
    return {
      patterns: [],
      errors: [],
    };
  }

  const result = await safeAsyncOperation(async () => {
    const content = await readFileContent(resolvedPath);
    const patterns = parseIgnoreContent(content);

    return {
      patterns,
      errors: [],
      source: filePath,
    };
  }, `Failed to parse ${filePath}`);

  if (!result.success) {
    return {
      patterns: [],
      errors: [result.error],
    };
  }

  // Ensure we always return a valid result
  if (!result.result) {
    return {
      patterns: [],
      errors: ["Unexpected error: result.result is undefined"],
    };
  }

  return result.result;
}

/**
 * Parse ignore file content and extract patterns
 */
export function parseIgnoreContent(content: string): string[] {
  return content
    .split("\n")
    .map((line) => line.trim())
    .filter((line) => line && !line.startsWith("#"));
}

/**
 * Parse ignore patterns from JSON object (for settings-based ignore)
 */
export function parseIgnoreFromSettings(
  settings: unknown,
  extractorFn: (settings: unknown) => string[] | undefined,
): IgnoreParseResult {
  try {
    const patterns = extractorFn(settings);
    return {
      patterns: patterns || [],
      errors: [],
      source: "settings.json",
    };
  } catch (error) {
    return {
      patterns: [],
      errors: [`Failed to extract ignore patterns from settings: ${getErrorMessage(error)}`],
    };
  }
}

/**
 * Validate an ignore pattern (basic gitignore-style validation)
 */
export function validateIgnorePattern(pattern: string): boolean {
  // Empty patterns are invalid
  if (!pattern || pattern.trim() === "") {
    return false;
  }

  // Patterns starting with # are comments (handled by parseIgnoreContent)
  if (pattern.startsWith("#")) {
    return false;
  }

  // Basic validation - most patterns are valid in gitignore syntax
  return true;
}

/**
 * Normalize ignore patterns by removing duplicates and empty patterns
 */
export function normalizeIgnorePatterns(patterns: string[]): string[] {
  const seen = new Set<string>();
  return patterns
    .map((pattern) => pattern.trim())
    .filter((pattern) => {
      if (!pattern || pattern.startsWith("#") || seen.has(pattern)) {
        return false;
      }
      seen.add(pattern);
      return validateIgnorePattern(pattern);
    });
}

/**
 * Extract ignore patterns from Claude Code settings permissions.deny
 */
export function extractClaudeCodeIgnorePatterns(settings: unknown): string[] | undefined {
  if (typeof settings !== "object" || settings === null || !("permissions" in settings)) {
    return undefined;
  }

  const permissions = settings.permissions;
  if (typeof permissions !== "object" || permissions === null) {
    return undefined;
  }

  if (!("deny" in permissions) || !Array.isArray(permissions.deny)) {
    return undefined;
  }

  return permissions.deny
    .filter(
      (rule: unknown): rule is string =>
        typeof rule === "string" && rule.startsWith("Read(") && rule.endsWith(")"),
    )
    .map((rule: string) => {
      const match = rule.match(/^Read\((.+)\)$/);
      return match ? match[1] : null;
    })
    .filter((pattern): pattern is string => pattern !== null);
}
