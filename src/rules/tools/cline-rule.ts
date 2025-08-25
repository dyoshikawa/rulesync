import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { clineContentSchema, clineFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Cline rule implementation
 *
 * Cline uses project rules through Markdown files in the `.clinerules/` directory.
 * Only files directly in `.clinerules/` are loaded (no subdirectory support).
 */
export class ClineRule implements ToolRule {
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
   * Build a ClineRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): ClineRule {
    const { filePath, fileContent } = params;
    return new ClineRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a ClineRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<ClineRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return ClineRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a ClineRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): ClineRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Cline uses .clinerules/ directory structure (flat, no subdirectories)
    const isRootRule = frontmatter.root === true;
    const ruleName = isRootRule ? "project-rules" : filename;
    const clinePath = path.join(dir, ".clinerules", `${ruleName}.md`);

    // Cline doesn't use frontmatter, just pure markdown content
    const clineContent = content;

    return new ClineRule({
      filePath: clinePath,
      content: clineContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Extract the directory from the cline path
    const pathParts = this.filePath.split(path.sep);
    const clinerulesIndex = pathParts.lastIndexOf(".clinerules");

    // Get the base directory (before .clinerules)
    const baseDir = pathParts.slice(0, clinerulesIndex).join(path.sep) || ".";
    const filename = path.basename(this.filePath, ".md");

    // Determine if this is a root rule based on file name
    const isRootRule = filename === "project-rules";

    const rulesyncFilename = isRootRule ? "cline-root-rule" : `cline-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter for the Rulesync rule
    const frontmatter: Record<string, unknown> = {
      target: "cline" as const,
      description: isRootRule ? "Cline project rules" : `Cline rules - ${filename}`,
    };

    if (isRootRule) {
      frontmatter.root = true;
    }

    // Create the Rulesync rule with frontmatter
    const rulesyncFrontmatterLines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (typeof value === "string" && (value.includes(":") || value.includes("-"))) {
        rulesyncFrontmatterLines.push(`${key}: "${value}"`);
      } else {
        rulesyncFrontmatterLines.push(`${key}: ${value}`);
      }
    }
    rulesyncFrontmatterLines.push("---", "");

    const fileContent = rulesyncFrontmatterLines.join("\n") + this.content;

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
      clineFilePathSchema.parse(this.filePath);

      // Validate content
      clineContentSchema.parse(this.content);

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
