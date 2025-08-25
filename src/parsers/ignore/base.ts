import type { ToolTarget } from "../../types/tool-targets.js";

/**
 * Result of parsing ignore patterns
 */
export interface IgnoreParseResult {
  patterns: string[];
  errors: string[];
  source?: string; // e.g., ".cursorignore", "settings.json"
}

/**
 * Abstract base class for ignore parsers
 */
export abstract class BaseIgnoreParser {
  /**
   * Get the tool name this parser is for
   */
  abstract getToolName(): ToolTarget;

  /**
   * Get the ignore file name(s) this parser looks for
   */
  abstract getIgnoreFileName(): string | string[];

  /**
   * Parse ignore patterns from the given base directory
   */
  abstract parseIgnorePatterns(baseDir: string): Promise<IgnoreParseResult>;

  /**
   * Optional: tool-specific validation for ignore patterns
   */
  validatePattern?(pattern: string): boolean;

  /**
   * Optional: tool-specific transformation for ignore patterns
   */
  transformPattern?(pattern: string): string;

  /**
   * Combine multiple ignore parse results
   */
  protected combineResults(...results: IgnoreParseResult[]): IgnoreParseResult {
    const combined: IgnoreParseResult = {
      patterns: [],
      errors: [],
    };

    for (const result of results) {
      combined.patterns.push(...result.patterns);
      combined.errors.push(...result.errors);
      if (result.source && !combined.source) {
        combined.source = result.source;
      }
    }

    return combined;
  }
}
