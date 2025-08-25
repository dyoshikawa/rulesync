import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";
import { extractClaudeCodeIgnorePatterns } from "./shared.js";

/**
 * Parser for Claude Code ignore patterns
 * Handles settings.json permissions.deny patterns
 */
export class ClaudeCodeIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "claudecode";
  }

  getIgnoreFileName(): string {
    return ".claude/settings.json";
  }

  async parseIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    const settingsPath = resolvePath(this.getIgnoreFileName(), baseDir);

    if (!(await fileExists(settingsPath))) {
      return {
        patterns: [],
        errors: [],
      };
    }

    try {
      const content = await readFileContent(settingsPath);
      const settings = JSON.parse(content);

      const patterns = extractClaudeCodeIgnorePatterns(settings);
      return {
        patterns: patterns || [],
        errors: [],
        source: ".claude/settings.json",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        patterns: [],
        errors: [`Failed to parse Claude Code settings: ${errorMessage}`],
      };
    }
  }
}
