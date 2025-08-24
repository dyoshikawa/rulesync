import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { agentsmdContentSchema, agentsmdFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * AGENTS.md rule implementation
 *
 * AGENTS.md is used by multiple tools (opencode, codexcli, etc.) as a
 * project-level rules/instructions file.
 */
export class AgentsmdRule implements ToolRule {
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
   * Build an AgentsmdRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): AgentsmdRule {
    const { filePath, fileContent } = params;
    return new AgentsmdRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load an AgentsmdRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<AgentsmdRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return AgentsmdRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create an AgentsmdRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): AgentsmdRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // If it's a root rule, use AGENTS.md
    // If it's a detail rule, use .agents/memories/ directory
    const isRootRule = frontmatter.root === true;
    const filename = path.basename(originalPath, path.extname(originalPath));

    const agentsmdPath = isRootRule
      ? path.join(dir, "AGENTS.md")
      : path.join(dir, ".agents", "memories", `${filename}.md`);

    return new AgentsmdRule({
      filePath: agentsmdPath,
      content,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Extract the directory from the AGENTS.md path
    const dir = path.dirname(this.filePath);
    const rulesyncPath = path.join(dir, "agentsmd-rule.md");

    // Create frontmatter for the Rulesync rule
    const frontmatter = {
      target: "agentsmd" as const,
      description: "Project-level instructions for AI agents",
    };

    // Create the Rulesync rule with frontmatter
    const fileContent = `---
target: ${frontmatter.target}
description: ${frontmatter.description}
---

${this.content.trim()}`;

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
      agentsmdFilePathSchema.parse(this.filePath);

      // Validate content
      agentsmdContentSchema.parse(this.content);

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
