import { z } from "zod/mini";

/**
 * Plugin source types.
 * - `github`: GitHub repository (e.g., `owner/repo`)
 * - `local`: Local file path (e.g., `../shared-rules`)
 * - `url`: Remote URL (e.g., `https://example.com/plugin.zip`)
 */
export const PluginSourceTypeSchema = z.enum(["github", "local", "url"]);
export type PluginSourceType = z.infer<typeof PluginSourceTypeSchema>;

/**
 * Parsed plugin identifier.
 */
export type ParsedPluginIdentifier = {
  /** Plugin name (used for display and caching) */
  name: string;
  /** Source type (github, local, url) */
  sourceType: PluginSourceType;
  /** Source path (repository path, local path, or URL) */
  sourcePath: string;
  /** Original identifier string */
  original: string;
};

/**
 * Regular expression to parse plugin identifiers.
 * Format: `name@source:path`
 * Examples:
 * - `typescript-rules@github:rulesync-community/typescript-rules`
 * - `my-team-rules@local:../shared-rulesync`
 * - `remote-rules@url:https://example.com/plugin.zip`
 */
const PLUGIN_IDENTIFIER_REGEX = /^([^@]+)@(github|local|url):(.+)$/;

/**
 * Parse a plugin identifier string into its components.
 *
 * @param identifier - Plugin identifier string (e.g., `name@github:owner/repo`)
 * @returns Parsed plugin identifier or null if invalid
 */
export function parsePluginIdentifier(identifier: string): ParsedPluginIdentifier | null {
  const match = identifier.match(PLUGIN_IDENTIFIER_REGEX);
  if (!match) {
    return null;
  }

  const [, name, sourceType, sourcePath] = match;
  if (!name || !sourceType || !sourcePath) {
    return null;
  }

  const sourceTypeResult = PluginSourceTypeSchema.safeParse(sourceType);
  if (!sourceTypeResult.success) {
    return null;
  }

  return {
    name,
    sourceType: sourceTypeResult.data,
    sourcePath,
    original: identifier,
  };
}

/**
 * Validate a plugin identifier string.
 *
 * @param identifier - Plugin identifier string
 * @returns True if the identifier is valid
 */
export function isValidPluginIdentifier(identifier: string): boolean {
  return parsePluginIdentifier(identifier) !== null;
}

/**
 * Generate a cache key for a plugin identifier.
 * Used for storing plugins in the cache directory.
 *
 * @param parsed - Parsed plugin identifier
 * @returns Cache key string (safe for use as directory name)
 */
export function generatePluginCacheKey(parsed: ParsedPluginIdentifier): string {
  // Replace special characters with dashes for safe directory names
  const safePath = parsed.sourcePath.replace(/[/\\:@]/g, "-");
  return `${parsed.name}@${parsed.sourceType}-${safePath}`;
}
