import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { opencodeContentSchema, opencodeFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * OpenCode rule implementation
 *
 * OpenCode uses AGENTS.md files for project-specific rules and instructions.
 * The system searches upward from the current directory to find AGENTS.md files.
 */
export class OpencodeRule implements ToolRule {
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
   * Build an OpencodeRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): OpencodeRule {
    const { filePath, fileContent } = params;
    return new OpencodeRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load an OpencodeRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<OpencodeRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return OpencodeRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create an OpencodeRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): OpencodeRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);

    // OpenCode uses AGENTS.md in the project root
    const opencodePath = path.join(dir, "AGENTS.md");

    // OpenCode uses plain markdown without frontmatter
    const opencodeContent = content;

    return new OpencodeRule({
      filePath: opencodePath,
      content: opencodeContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // OpenCode files are plain markdown, so we need to create frontmatter
    const dir = path.dirname(this.filePath);
    const filename = path.basename(this.filePath, ".md");

    // Create filename for Rulesync
    const rulesyncFilename = `opencode-${filename.toLowerCase()}`;
    const rulesyncPath = path.join(dir, `${rulesyncFilename}.md`);

    // Create frontmatter
    const frontmatter = {
      target: "opencode" as const,
      description: "OpenCode project rules and instructions",
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
      opencodeFilePathSchema.parse(this.filePath);

      // Validate content
      opencodeContentSchema.parse(this.content);

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
