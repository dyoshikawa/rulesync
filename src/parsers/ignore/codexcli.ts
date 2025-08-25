import type { ToolTarget } from "../../types/tool-targets.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";
import { parseIgnoreFile } from "./shared.js";

/**
 * Parser for Codex CLI ignore patterns
 * Handles .codexignore files (community/unofficial support)
 */
export class CodexCliIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "codexcli";
  }

  getIgnoreFileName(): string {
    return ".codexignore";
  }

  async parseIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    return parseIgnoreFile(this.getIgnoreFileName(), baseDir);
  }
}
