import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { qwencodeContentSchema, qwencodeFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * QwenCode rule implementation
 *
 * QwenCode uses a context management system similar to Gemini CLI with configurable
 * context filenames (QWEN.md, AGENTS.md, GEMINI.md) for project-specific rules.
 */
export class QwencodeRule implements ToolRule {
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
   * Build a QwencodeRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): QwencodeRule {
    const { filePath, fileContent } = params;
    return new QwencodeRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a QwencodeRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<QwencodeRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return QwencodeRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a QwencodeRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): QwencodeRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // QwenCode defaults to QWEN.md but can be configured
    // We'll use QWEN.md as the default
    const qwencodePath = path.join(dir, "QWEN.md");

    // QwenCode uses plain markdown without frontmatter for context files
    const qwencodeContent = content;

    return new QwencodeRule({
      filePath: qwencodePath,
      content: qwencodeContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // QwenCode files are plain markdown, so we need to create frontmatter
    const dir = path.dirname(this.filePath);
    const filename = path.basename(this.filePath, ".md");

    // Create filename for Rulesync
    const rulesyncFilename = `qwencode-${filename.toLowerCase()}`;
    const rulesyncPath = path.join(dir, `${rulesyncFilename}.md`);

    // Create frontmatter
    const frontmatter = {
      target: "qwencode" as const,
      description: `QwenCode context and memory for ${filename}`,
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
      qwencodeFilePathSchema.parse(this.filePath);

      // Validate content
      qwencodeContentSchema.parse(this.content);

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
