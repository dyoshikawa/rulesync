import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import {
  type ClaudecodeConstructorParams,
  claudecodeContentSchema,
  claudecodeFilePathSchema,
} from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Claude Code memory file implementation
 *
 * Claude Code uses CLAUDE.md files as memory/context files.
 * These can be placed at:
 * - Project root: ./CLAUDE.md
 * - User global: ~/.claude/CLAUDE.md
 */
export class ClaudecodeRule implements ToolRule {
  private filePath: string;
  private content: string;

  private constructor(params: ClaudecodeConstructorParams) {
    this.filePath = params.filePath;
    this.content = params.content;
  }

  /**
   * Build a ClaudecodeRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): ClaudecodeRule {
    const { filePath, fileContent } = params;
    return new ClaudecodeRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a ClaudecodeRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<ClaudecodeRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return ClaudecodeRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Convert from RulesyncRule to ClaudecodeRule
   */
  static fromRulesyncRule(rule: RulesyncRule): ClaudecodeRule {
    // Extract content without frontmatter for Claude Code
    const content = rule.getContent();

    // Determine the appropriate file path
    const originalPath = rule.getFilePath();
    const dir = path.dirname(originalPath);
    const claudecodePath = path.join(dir, "CLAUDE.md");

    return new ClaudecodeRule({
      filePath: claudecodePath,
      content,
    });
  }

  /**
   * Write the rule to the file system
   */
  async writeFile(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });
    await fs.writeFile(this.filePath, this.content, "utf-8");
  }

  /**
   * Validate the rule content using zod schemas
   */
  validate(): ValidationResult {
    try {
      // Validate file path
      claudecodeFilePathSchema.parse(this.filePath);

      // Validate content
      claudecodeContentSchema.parse(this.content);

      // Additional validation for file location
      const dir = path.dirname(this.filePath);
      const isProjectRoot = !dir.includes(".claude");
      const isUserGlobal = dir.endsWith(".claude");

      if (!isProjectRoot && !isUserGlobal) {
        return {
          success: false,
          error: new Error("Claude Code memory must be at project root or ~/.claude/"),
        };
      }

      return { success: true, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        const message = error.issues.map((e) => `${e.path.join(".")}: ${e.message}`).join(", ");
        return {
          success: false,
          error: new Error(message),
        };
      }
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }
  }

  /**
   * Get the file path
   */
  getFilePath(): string {
    return this.filePath;
  }

  /**
   * Get the file content
   */
  getFileContent(): string {
    return this.content;
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Create frontmatter for the Rulesync rule
    const frontmatter = {
      target: "claudecode",
      description: "Claude Code memory configuration",
      modified: new Date().toISOString(),
    };

    // Create a RulesyncRule with the content and frontmatter
    const fileContent = `---
target: ${frontmatter.target}
description: ${frontmatter.description}
modified: ${frontmatter.modified}
---
${this.content}`;

    // Determine the Rulesync rule path
    const dir = path.dirname(this.filePath);
    const rulesyncPath = path.join(dir, "rules", "claudecode.md");

    return RulesyncRule.build({
      filePath: rulesyncPath,
      fileContent,
    });
  }

  /**
   * Get the content
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Set the content
   */
  setContent(content: string): void {
    this.content = content;
  }

  /**
   * Set the file path
   */
  setFilePath(filePath: string): void {
    this.filePath = filePath;
  }
}
