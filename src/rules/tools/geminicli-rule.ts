import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { geminicliContentSchema, geminicliFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Gemini CLI rule implementation
 *
 * Gemini CLI uses GEMINI.md files for project-level memory and context.
 * The system supports both global and project-level configuration files.
 */
export class GeminicliRule implements ToolRule {
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
   * Build a GeminicliRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): GeminicliRule {
    const { filePath, fileContent } = params;
    return new GeminicliRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a GeminicliRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<GeminicliRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return GeminicliRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a GeminicliRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): GeminicliRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // Gemini CLI uses GEMINI.md in the project root
    const geminiPath = path.join(dir, "GEMINI.md");

    // Gemini CLI uses plain markdown without frontmatter
    const geminiContent = content;

    return new GeminicliRule({
      filePath: geminiPath,
      content: geminiContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Gemini CLI files are plain markdown, so we need to create frontmatter
    const dir = path.dirname(this.filePath);
    const filename = path.basename(this.filePath, ".md");

    // Create filename for Rulesync
    const rulesyncFilename = `geminicli-${filename.toLowerCase()}`;
    const rulesyncPath = path.join(dir, `${rulesyncFilename}.md`);

    // Create frontmatter
    const frontmatter = {
      target: "geminicli" as const,
      description: "Gemini CLI memory and project context",
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
      geminicliFilePathSchema.parse(this.filePath);

      // Validate content
      geminicliContentSchema.parse(this.content);

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
