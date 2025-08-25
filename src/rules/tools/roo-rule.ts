import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { rooContentSchema, rooFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Roo Code rule implementation
 *
 * Roo Code uses a hierarchical system of instruction and rule files in the
 * `.roo/rules/` directory with support for mode-specific rules and unlimited
 * recursive nesting depth.
 */
export class RooRule implements ToolRule {
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
   * Build a RooRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): RooRule {
    const { filePath, fileContent } = params;
    return new RooRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a RooRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<RooRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return RooRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a RooRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): RooRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Determine if this is a root rule or mode-specific
    const isRootRule = frontmatter.root === true;
    // Access mode as a custom field safely without type assertion
    const frontmatterObj = Object(frontmatter);
    const mode = typeof frontmatterObj.mode === "string" ? String(frontmatterObj.mode) : undefined;

    // Extract the base filename for Roo rules
    let cleanFilename = filename.replace(/^roo-/, "");

    // Remove mode suffix from filename if present
    if (mode && cleanFilename.endsWith(`-${mode}`)) {
      cleanFilename = cleanFilename.slice(0, -mode.length - 1);
    }

    // Remove root suffix from filename if present
    if (isRootRule && cleanFilename.endsWith("-root")) {
      cleanFilename = cleanFilename.slice(0, -5);
    }

    let rooPath: string;
    if (mode) {
      // Mode-specific rule
      rooPath = path.join(dir, ".roo", `rules-${mode}`, `${cleanFilename}.md`);
    } else if (isRootRule) {
      // Root rule goes in main rules directory
      rooPath = path.join(dir, ".roo", "rules", `${cleanFilename}.md`);
    } else {
      // Regular rule
      rooPath = path.join(dir, ".roo", "rules", `${cleanFilename}.md`);
    }

    // Roo uses plain markdown without frontmatter
    const rooContent = content;

    return new RooRule({
      filePath: rooPath,
      content: rooContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    const filename = path.basename(this.filePath, ".md");

    // Determine if this is a mode-specific rule
    const pathParts = this.filePath.split(path.sep);
    const rooIndex = pathParts.lastIndexOf(".roo");
    const rulesDir = pathParts[rooIndex + 1] || "";

    let mode: string | undefined;
    let isRootRule = false;

    if (rulesDir.startsWith("rules-")) {
      mode = rulesDir.replace("rules-", "");
    } else if (rulesDir === "rules") {
      // Determine if this is a root rule based on filename or content
      isRootRule =
        filename.includes("global") ||
        filename.includes("root") ||
        this.content.toLowerCase().includes("workspace-wide") ||
        this.content.toLowerCase().includes("global");
    }

    // Get the base directory (before .roo)
    const baseDir = pathParts.slice(0, rooIndex).join(path.sep) || ".";

    // Create filename for Rulesync
    const rulesyncFilename = mode
      ? `roo-${filename}-${mode}`
      : isRootRule
        ? `roo-${filename}-root`
        : `roo-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter
    const frontmatter: Record<string, unknown> = {
      target: "roo" as const,
      description: mode
        ? `Roo Code rules for ${mode} mode - ${filename}`
        : isRootRule
          ? `Roo Code root rules - ${filename}`
          : `Roo Code rules - ${filename}`,
    };

    if (mode) {
      frontmatter.mode = mode;
    }

    if (isRootRule) {
      frontmatter.root = true;
    }

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
      rooFilePathSchema.parse(this.filePath);

      // Validate content
      rooContentSchema.parse(this.content);

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
