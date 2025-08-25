import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";
import { parseIgnoreFile } from "./shared.js";

/**
 * Parser for Gemini CLI ignore patterns
 * Handles .aiexclude files
 */
export class GeminiCliIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "geminicli";
  }

  getIgnoreFileName(): string {
    return ".aiexclude";
  }

  async parseIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    return parseIgnoreFile(this.getIgnoreFileName(), baseDir);
  }
}
