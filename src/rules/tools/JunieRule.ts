import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { junieContentSchema, junieFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Junie rule implementation
 *
 * JetBrains Junie uses a project-level configuration file at `.junie/guidelines.md`
 * to provide persistent, version-controlled context that is the "brain" of Junie.
 */
export class JunieRule implements ToolRule {
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
   * Build a JunieRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): JunieRule {
    const { filePath, fileContent } = params;
    return new JunieRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a JunieRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<JunieRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return JunieRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a JunieRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): JunieRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // Junie uses .junie/guidelines.md as the primary configuration file
    const juniePath = path.join(dir, ".junie", "guidelines.md");

    // Junie uses plain markdown without frontmatter
    const junieContent = content;

    return new JunieRule({
      filePath: juniePath,
      content: junieContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Get the base directory (before .junie)
    const pathParts = this.filePath.split(path.sep);
    const junieIndex = pathParts.lastIndexOf(".junie");
    const baseDir = pathParts.slice(0, junieIndex).join(path.sep) || ".";

    // Create filename for Rulesync
    const rulesyncFilename = "junie-guidelines";
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter
    const frontmatter = {
      target: "junie" as const,
      description: "JetBrains Junie guidelines and rules configuration",
    };

    // Build the frontmatter lines
    const frontmatterLines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === "string" && (value.includes(":") || value.includes("-"))) {
        frontmatterLines.push(`${key}: "${value}"`);
      } else {
        frontmatterLines.push(`${key}: ${value}`);
      }
    }
    frontmatterLines.push("---", "");

    const fileContent = frontmatterLines.join("\n") + this.content;

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
      junieFilePathSchema.parse(this.filePath);

      // Validate content
      junieContentSchema.parse(this.content);

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
