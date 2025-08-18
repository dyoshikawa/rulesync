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
