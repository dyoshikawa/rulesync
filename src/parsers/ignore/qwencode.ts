import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";

/**
 * Parser for Qwen Code ignore patterns
 * Note: Based on the existing parser, QwenCode uses the memory-based configuration system
 * and doesn't seem to have specific ignore file support beyond that
 */
export class QwenCodeIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "qwencode";
  }

  getIgnoreFileName(): string {
    return ""; // QwenCode doesn't have a specific ignore file
  }

  async parseIgnorePatterns(_baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    // QwenCode doesn't have specific ignore patterns in the current implementation
    // The ignore patterns come from the memory-based configuration system
    return {
      patterns: [],
      errors: [],
    };
  }
}
