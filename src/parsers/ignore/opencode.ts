import type { ToolTarget } from "../../types/tool-targets.js";
import { fileExists, readFileContent, resolvePath } from "../../utils/file.js";
import { parseIgnoreFile } from "../../utils/ignore.js";
import { BaseIgnoreParser, type IgnoreParseResult } from "./base.js";

/**
 * Parser for OpenCode ignore patterns
 * Handles both .opcodeignore files and opencode.json configuration files
 */
export class OpenCodeIgnoreParser extends BaseIgnoreParser {
  getToolName(): ToolTarget {
    return "opencode";
  }

  getIgnoreFileName(): string {
    return ".opcodeignore";
  }

  async parseIgnorePatterns(baseDir: string = process.cwd()): Promise<IgnoreParseResult> {
    // First, try to parse .opcodeignore file
    const opcodeignorePath = resolvePath(".opcodeignore", baseDir);

    if (await fileExists(opcodeignorePath)) {
      try {
        const content = await readFileContent(opcodeignorePath);
        const patterns = parseIgnoreFile(content);
        return {
          patterns,
          errors: [],
          source: ".opcodeignore",
        };
      } catch (error) {
        const errorMessage = error instanceof Error ? error.message : String(error);
        return {
          patterns: [],
          errors: [`Failed to parse .opcodeignore file: ${errorMessage}`],
        };
      }
    }

    // Fallback to opencode.json configuration
    const configPath = resolvePath("opencode.json", baseDir);

    if (!(await fileExists(configPath))) {
      return {
        patterns: [],
        errors: [],
      };
    }

    try {
      const content = await readFileContent(configPath);
      const config = JSON.parse(content);

      const patterns = this.extractOpenCodeIgnorePatterns(config);
      return {
        patterns: patterns || [],
        errors: [],
        source: "opencode.json",
      };
    } catch (error) {
      const errorMessage = error instanceof Error ? error.message : String(error);
      return {
        patterns: [],
        errors: [`Failed to parse OpenCode configuration: ${errorMessage}`],
      };
    }
  }

  /**
   * Extract ignore patterns from OpenCode configuration
   */
  private extractOpenCodeIgnorePatterns(config: unknown): string[] | undefined {
    if (typeof config !== "object" || config === null) {
      return undefined;
    }

    // OpenCode might have ignore patterns in different places
    // This is a placeholder implementation - adjust based on actual OpenCode config structure
    if ("ignorePatterns" in config && Array.isArray(config.ignorePatterns)) {
      return config.ignorePatterns.filter(
        (pattern): pattern is string => typeof pattern === "string",
      );
    }

    return undefined;
  }
}
