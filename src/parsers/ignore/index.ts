import { AmazonQCliIgnoreParser } from "./amazonqcli.js";
import type { IgnoreParseResult } from "./base.js";
import { ClaudeCodeIgnoreParser } from "./claudecode.js";
import { CodexCliIgnoreParser } from "./codexcli.js";
import { CursorIgnoreParser } from "./cursor.js";
import { GeminiCliIgnoreParser } from "./geminicli.js";
import { OpenCodeIgnoreParser } from "./opencode.js";
import { QwenCodeIgnoreParser } from "./qwencode.js";

// Export specific parsers
export { AmazonQCliIgnoreParser } from "./amazonqcli.js";
// Export base class and types
export { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";
export { ClaudeCodeIgnoreParser } from "./claudecode.js";
export { CodexCliIgnoreParser } from "./codexcli.js";
export { CursorIgnoreParser } from "./cursor.js";
export { GeminiCliIgnoreParser } from "./geminicli.js";
export { OpenCodeIgnoreParser } from "./opencode.js";
export { QwenCodeIgnoreParser } from "./qwencode.js";

// Export shared utilities
export {
  extractClaudeCodeIgnorePatterns,
  normalizeIgnorePatterns,
  parseIgnoreContent,
  parseIgnoreFile,
  parseIgnoreFromSettings,
  validateIgnorePattern,
} from "./shared.js";

/**
 * Interface for ignore parsers
 */
export interface IgnoreParser {
  parseIgnorePatterns(baseDir: string): Promise<IgnoreParseResult>;
  getIgnoreFileName(): string | string[];
}

/**
 * Registry of ignore parsers
 */
const ignoreParsers: Record<string, IgnoreParser> = {
  amazonqcli: new AmazonQCliIgnoreParser(),
  claudecode: new ClaudeCodeIgnoreParser(),
  codexcli: new CodexCliIgnoreParser(),
  cursor: new CursorIgnoreParser(),
  geminicli: new GeminiCliIgnoreParser(),
  opencode: new OpenCodeIgnoreParser(),
  qwencode: new QwenCodeIgnoreParser(),
};

/**
 * Get an ignore parser for the given tool
 */
export function getIgnoreParser(tool: string): IgnoreParser | undefined {
  return ignoreParsers[tool];
}

/**
 * Get all available ignore parser tool names
 */
export function getAvailableIgnoreParserTools(): string[] {
  return Object.keys(ignoreParsers);
}

/**
 * Parse ignore patterns for the given tool and base directory
 */
export async function parseIgnorePatterns(
  tool: string,
  baseDir: string = process.cwd(),
): Promise<IgnoreParseResult> {
  const parser = getIgnoreParser(tool);
  if (!parser) {
    return {
      patterns: [],
      errors: [`No ignore parser available for tool: ${tool}`],
    };
  }

  return parser.parseIgnorePatterns(baseDir);
}
