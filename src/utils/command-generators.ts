import { join } from "node:path";
import type { CommandOutput, ParsedCommand } from "../types/commands.js";
import type { ToolTarget } from "../types/tool-targets.js";

/**
 * Common utilities for command generators
 */

export interface FrontmatterOptions {
  includeDescription?: boolean;
  additionalFields?: Array<{ key: string; value: string }>;
}

/**
 * Generate YAML frontmatter for command files
 */
export function generateYamlFrontmatter(
  command: ParsedCommand,
  options: FrontmatterOptions = {},
): string[] {
  const frontmatter: string[] = ["---"];

  if (options.includeDescription !== false && command.frontmatter.description) {
    frontmatter.push(`description: ${command.frontmatter.description}`);
  }

  if (options.additionalFields) {
    for (const field of options.additionalFields) {
      frontmatter.push(`${field.key}: ${field.value}`);
    }
  }

  frontmatter.push("---");
  return frontmatter;
}

/**
 * Build complete command content with frontmatter and body
 */
export function buildCommandContent(
  command: ParsedCommand,
  frontmatterOptions?: FrontmatterOptions,
): string {
  const frontmatter = generateYamlFrontmatter(command, frontmatterOptions);
  return `${frontmatter.join("\n")}\n\n${command.content.trim()}\n`;
}

/**
 * Generate flattened output path for commands that don't support subdirectories
 */
export function getFlattenedCommandPath(filename: string, baseDir: string, subdir: string): string {
  const flattenedName = filename.replace(/\//g, "-");
  return join(baseDir, subdir, `${flattenedName}.md`);
}

/**
 * Generate hierarchical output path for commands that support subdirectories
 */
export function getHierarchicalCommandPath(
  filename: string,
  baseDir: string,
  subdir: string,
  extension: string = "md",
): string {
  // Remove existing extension if present, then add the target extension
  const nameWithoutExt = filename.replace(/\.[^/.]+$/, "");
  const fileWithExt = `${nameWithoutExt}.${extension}`;
  return join(baseDir, subdir, fileWithExt);
}

/**
 * Base command generator interface for consistency
 */
export interface BaseCommandGenerator {
  generate(command: ParsedCommand, outputDir: string): CommandOutput;
  getOutputPath(filename: string, baseDir: string): string;
}

/**
 * Create a simple markdown command generator for tools that use YAML frontmatter
 */
export function createMarkdownCommandGenerator(
  tool: ToolTarget,
  commandsSubdir: string,
  useFlattened: boolean = true,
): BaseCommandGenerator {
  return {
    generate(command: ParsedCommand, outputDir: string): CommandOutput {
      const filepath = this.getOutputPath(command.filename, outputDir);
      const content = buildCommandContent(command);

      return {
        tool,
        filepath,
        content,
      };
    },

    getOutputPath(filename: string, baseDir: string): string {
      if (useFlattened) {
        return getFlattenedCommandPath(filename, baseDir, commandsSubdir);
      } else {
        return getHierarchicalCommandPath(filename, baseDir, commandsSubdir);
      }
    },
  };
}

/**
 * Escape special characters for TOML strings
 */
export function escapeTomlString(str: string): string {
  return str
    .replace(/\\/g, "\\\\")
    .replace(/"/g, '\\"')
    .replace(/\n/g, "\\n")
    .replace(/\r/g, "\\r")
    .replace(/\t/g, "\\t");
}

/**
 * Convert Claude Code command syntax to other formats
 */
export const syntaxConverters = {
  /**
   * Convert Claude Code syntax to Gemini CLI syntax
   */
  toGeminiCli(content: string): string {
    let converted = content;

    // Convert $ARGUMENTS to {{args}}
    converted = converted.replace(/\$ARGUMENTS/g, "{{args}}");

    // Convert shell command injection: !`command` to !{command}
    converted = converted.replace(/!`([^`]+)`/g, "!{$1}");

    return converted.trim();
  },

  /**
   * Convert to Roo Code syntax (currently identical to Claude Code)
   */
  toRooCode(content: string): string {
    return content.trim();
  },
};
