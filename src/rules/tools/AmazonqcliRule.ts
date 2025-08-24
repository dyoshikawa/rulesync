import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { amazonqcliContentSchema, amazonqcliFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Amazon Q CLI rule implementation
 *
 * Amazon Q CLI uses a context management system with Markdown files
 * stored in the `.amazonq/rules/` directory.
 */
export class AmazonqcliRule implements ToolRule {
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
   * Build an AmazonqcliRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): AmazonqcliRule {
    const { filePath, fileContent } = params;
    return new AmazonqcliRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load an AmazonqcliRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<AmazonqcliRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return AmazonqcliRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create an AmazonqcliRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): AmazonqcliRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Amazon Q CLI uses .amazonq/rules/ directory for all rules
    // If it's a root rule, use a main rules file name
    // If it's a detail rule, use the original filename
    const isRootRule = frontmatter.root === true;
    const ruleName = isRootRule ? "project-rules" : filename;

    const amazonqcliPath = path.join(dir, ".amazonq", "rules", `${ruleName}.md`);

    return new AmazonqcliRule({
      filePath: amazonqcliPath,
      content,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Extract the directory from the amazonqcli path
    const pathParts = this.filePath.split(path.sep);
    const amazonqIndex = pathParts.lastIndexOf(".amazonq");

    // Get the base directory (before .amazonq)
    const baseDir = pathParts.slice(0, amazonqIndex).join(path.sep) || ".";
    const filename = path.basename(this.filePath, ".md");

    // Determine if this is a root rule based on filename
    const isRootRule = filename === "project-rules";
    const rulesyncFilename = isRootRule ? "amazonqcli-root-rule" : `amazonqcli-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter for the Rulesync rule
    const frontmatter: Record<string, unknown> = {
      target: "amazonqcli" as const,
      description: isRootRule
        ? "Project-level rules for Amazon Q CLI"
        : `Amazon Q CLI rules - ${filename}`,
    };

    if (isRootRule) {
      frontmatter.root = true;
    }

    // Create the Rulesync rule with frontmatter
    const frontmatterLines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      // Quote string values that contain special characters
      const formattedValue =
        typeof value === "string" && (value.includes(":") || value.includes("-"))
          ? `"${value}"`
          : value;
      frontmatterLines.push(`${key}: ${formattedValue}`);
    }
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
      amazonqcliFilePathSchema.parse(this.filePath);

      // Validate content
      amazonqcliContentSchema.parse(this.content);

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
