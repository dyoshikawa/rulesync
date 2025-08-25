import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { windsurfContentSchema, windsurfFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Windsurf rule implementation
 *
 * Windsurf uses workspace rules in the `.windsurf/rules/` directory to provide
 * persistent context and project-specific instructions. Each rule is a Markdown file
 * that can include YAML headers for activation modes and metadata.
 */
export class WindsurfRule implements ToolRule {
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
   * Build a WindsurfRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): WindsurfRule {
    const { filePath, fileContent } = params;
    return new WindsurfRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a WindsurfRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<WindsurfRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return WindsurfRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a WindsurfRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): WindsurfRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Extract the base filename for Windsurf rules
    const cleanFilename = filename.replace(/^windsurf-/, "");

    // Determine the rule type based on content or filename
    let ruleName = cleanFilename;

    // Map common rule types to descriptive names
    if (
      cleanFilename.includes("coding") ||
      cleanFilename.includes("standards") ||
      content.toLowerCase().includes("coding standards") ||
      content.toLowerCase().includes("style")
    ) {
      ruleName = "coding-standards";
    } else if (cleanFilename.includes("security") || content.toLowerCase().includes("security")) {
      ruleName = "security-rules";
    } else if (cleanFilename.includes("testing") || content.toLowerCase().includes("testing")) {
      ruleName = "testing-guidelines";
    } else if (
      cleanFilename.includes("architecture") ||
      content.toLowerCase().includes("architecture")
    ) {
      ruleName = "architecture";
    } else if (
      cleanFilename.includes("project") ||
      content.toLowerCase().includes("project-specific")
    ) {
      ruleName = "project-rules";
    }

    // Handle specific cases where the filename doesn't match the content-based logic
    if (cleanFilename === "security") {
      ruleName = "security";
    } else if (cleanFilename === "deployment") {
      ruleName = "deployment";
    }

    // Windsurf rules go in .windsurf/rules/ directory
    const windsurfPath = path.join(dir, ".windsurf", "rules", `${ruleName}.md`);

    // Windsurf uses markdown with optional YAML headers
    const windsurfContent = content;

    return new WindsurfRule({
      filePath: windsurfPath,
      content: windsurfContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    const filename = path.basename(this.filePath, ".md");

    // Get the base directory (before .windsurf)
    const pathParts = this.filePath.split(path.sep);
    const windsurfIndex = pathParts.lastIndexOf(".windsurf");
    const baseDir = pathParts.slice(0, windsurfIndex).join(path.sep) || ".";

    // Create filename for Rulesync
    const rulesyncFilename = `windsurf-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter based on rule type
    const frontmatter: Record<string, unknown> = {
      target: "windsurf" as const,
      description: this.getDescriptionForRuleType(filename),
    };

    // Add rule type for reference
    frontmatter.ruleType = filename;

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
   * Get description for rule type
   */
  private getDescriptionForRuleType(ruleType: string): string {
    switch (ruleType) {
      case "coding-standards":
        return "Windsurf coding standards and style guidelines";
      case "security-rules":
        return "Windsurf security requirements and best practices";
      case "testing-guidelines":
        return "Windsurf testing strategy and requirements";
      case "architecture":
        return "Windsurf architecture patterns and design principles";
      case "project-rules":
        return "Windsurf project-specific rules and conventions";
      default:
        return `Windsurf rule - ${ruleType}`;
    }
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
      windsurfFilePathSchema.parse(this.filePath);

      // Validate content
      windsurfContentSchema.parse(this.content);

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
