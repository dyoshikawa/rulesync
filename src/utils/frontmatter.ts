import matter from "gray-matter";

export interface ParsedContent {
  content: string;
  data: Record<string, unknown>;
}

export interface FrontmatterOptions {
  /**
   * Custom options for gray-matter parser
   */
  matterOptions?: Record<string, unknown>;
}

/**
 * Unified frontmatter parsing utility that standardizes how we handle frontmatter across the codebase
 */
export function parseFrontmatter(content: string, options?: FrontmatterOptions): ParsedContent {
  const parsed = matter(content, options?.matterOptions);

  return {
    content: parsed.content.trim(),
    data: parsed.data || {},
  };
}

/**
 * Safe frontmatter parsing that handles errors gracefully
 */
export function safeParseFrontmatter(
  content: string,
  options?: FrontmatterOptions,
): { success: true; result: ParsedContent } | { success: false; error: string } {
  try {
    const result = parseFrontmatter(content, options);
    return { success: true, result };
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : String(error),
    };
  }
}

/**
 * Type-safe frontmatter data extraction with default values
 */
export function extractFrontmatterField<T>(
  data: Record<string, unknown>,
  key: string,
  defaultValue: T,
): T {
  const value = data[key];
  // eslint-disable-next-line no-type-assertion/no-type-assertion
  return value !== undefined ? (value as T) : defaultValue;
}

/**
 * Extract array field from frontmatter with proper type checking
 */
export function extractArrayField(
  data: Record<string, unknown>,
  key: string,
  defaultValue: string[] = [],
): string[] {
  const value = data[key];
  return Array.isArray(value) ? value : defaultValue;
}

/**
 * Extract string field from frontmatter with fallback
 */
export function extractStringField(
  data: Record<string, unknown>,
  key: string,
  defaultValue: string,
): string {
  const value = data[key];
  return typeof value === "string" ? value : defaultValue;
}
