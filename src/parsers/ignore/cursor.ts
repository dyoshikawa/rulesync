import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";
import { parseIgnoreFile } from "./shared.js";

/**
 * Parser for Cursor ignore patterns
 * Handles .cursorignore files
 */
export class CursorIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "cursor";
  }

  getIgnoreFileName(): string {
    return ".cursorignore";
  }

  async parseIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    return parseIgnoreFile(this.getIgnoreFileName(), baseDir);
  }
}
