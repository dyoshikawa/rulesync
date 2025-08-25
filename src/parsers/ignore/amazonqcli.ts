import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";

/**
 * Parser for Amazon Q CLI ignore patterns
 * Note: Based on the existing parser, Amazon Q CLI doesn't seem to have
 * specific ignore file support in the current implementation
 */
export class AmazonQCliIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "amazonqcli";
  }

  getIgnoreFileName(): string {
    return ""; // Amazon Q CLI doesn't have a specific ignore file
  }

  async parseIgnorePatterns(_baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    // Amazon Q CLI doesn't have specific ignore patterns in the current implementation
    return {
      patterns: [],
      errors: [],
    };
  }
}
