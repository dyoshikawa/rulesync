import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { codexcliContentSchema, codexcliFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * OpenAI Codex CLI rule implementation
 *
 * Codex CLI uses a hierarchical instruction system:
 * 1. Global user instructions: ~/.codex/instructions.md
 * 2. Project instructions: <project-root>/AGENTS.md
 * 3. Directory-specific instructions: <cwd>/AGENTS.md
 *
 * Files are plain Markdown without frontmatter.
 */
export class CodexcliRule implements ToolRule {
  private filePath: string;
  private content: string;

  private constructor(params: {
    filePath: string;
    content: string;
  }) {
    this.filePath = params.filePath;
    this.content = params.content;
  }

  /**
   * Build a CodexcliRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): CodexcliRule {
    const { filePath, fileContent } = params;
    return new CodexcliRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a CodexcliRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<CodexcliRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return CodexcliRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a CodexcliRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): CodexcliRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // If it's a root rule, use AGENTS.md (project-level)
    // If it's a detail rule, use ~/.codex/instructions.md (global) or directory-specific AGENTS.md
    const isRootRule = frontmatter.root === true;

    let codexcliPath: string;
    if (isRootRule) {
      // Root rules go to project-level AGENTS.md
      codexcliPath = path.join(dir, "AGENTS.md");
    } else if (frontmatter.global === true) {
      // Global rules go to ~/.codex/instructions.md
      const homeDir = process.env.HOME || process.env.USERPROFILE || "";
      codexcliPath = path.join(homeDir, ".codex", "instructions.md");
    } else {
      // Directory-specific rules go to AGENTS.md in the same directory
      codexcliPath = path.join(dir, "AGENTS.md");
    }

    return new CodexcliRule({
      filePath: codexcliPath,
      content,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Extract the directory from the Codex CLI instruction path
    const dir = path.dirname(this.filePath);
    const rulesyncPath = path.join(dir, "codexcli-rule.md");

    // Determine rule type based on file path
    let isGlobal = false;
    let isRoot = false;

    if (this.filePath.includes(".codex/instructions.md")) {
      isGlobal = true;
    } else if (this.filePath.endsWith("AGENTS.md")) {
      // Check if this is a project root or directory-specific AGENTS.md
      // For simplicity, we'll assume it's a root rule if it's directly in the project
      isRoot = true;
    }

    // Create frontmatter for the Rulesync rule
    const frontmatter = {
      target: "codexcli" as const,
      description: isGlobal
        ? "Global user instructions for Codex CLI"
        : "Project-level instructions for Codex CLI",
      ...(isGlobal && { global: true }),
      ...(isRoot && { root: true }),
    };

    // Create the Rulesync rule with frontmatter
    const frontmatterLines = [
      "---",
      `target: ${frontmatter.target}`,
      `description: ${frontmatter.description}`,
    ];

    if (isGlobal) frontmatterLines.push("global: true");
    if (isRoot) frontmatterLines.push("root: true");

    frontmatterLines.push("---", "");

    const fileContent = frontmatterLines.join("\n") + this.content.trim();

    return RulesyncRule.build({
      filePath: rulesyncPath,
      fileContent,
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
   * Validate the rule
   */
  validate(): ValidationResult {
    try {
      // Validate file path
      codexcliFilePathSchema.parse(this.filePath);

      // Validate content
      codexcliContentSchema.parse(this.content);

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
}
