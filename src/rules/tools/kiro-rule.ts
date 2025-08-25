import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../rulesync-rule.js";
import { kiroContentSchema, kiroFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Kiro rule implementation
 *
 * Kiro uses steering documents in the `.kiro/steering/` directory to provide
 * permanent project context. The system includes core files like product.md,
 * structure.md, and tech.md, but only supports flat structure (no subdirectories).
 */
export class KiroRule implements ToolRule {
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
   * Build a KiroRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): KiroRule {
    const { filePath, fileContent } = params;
    return new KiroRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a KiroRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<KiroRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return KiroRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a KiroRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): KiroRule {
    const content = rulesyncRule.getContent().trim();
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Extract the base filename for Kiro steering documents
    const cleanFilename = filename.replace(/^kiro-/, "");

    // Determine the steering document type based on content or filename
    let steeringType = cleanFilename;

    // Map common rule types to Kiro steering document names
    if (
      cleanFilename.includes("product") ||
      content.toLowerCase().includes("target users") ||
      content.toLowerCase().includes("user experience") ||
      content.toLowerCase().includes("release criteria")
    ) {
      steeringType = "product";
    } else if (
      cleanFilename.includes("structure") ||
      content.toLowerCase().includes("repository layout") ||
      content.toLowerCase().includes("module boundaries") ||
      content.toLowerCase().includes("directory")
    ) {
      steeringType = "structure";
    } else if (
      cleanFilename.includes("tech") ||
      cleanFilename.includes("technology") ||
      content.toLowerCase().includes("language version") ||
      content.toLowerCase().includes("framework")
    ) {
      steeringType = "tech";
    }

    // Kiro steering documents go in .kiro/steering/ directory
    const kiroPath = path.join(dir, ".kiro", "steering", `${steeringType}.md`);

    // Kiro uses plain markdown without frontmatter
    const kiroContent = content;

    return new KiroRule({
      filePath: kiroPath,
      content: kiroContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    const filename = path.basename(this.filePath, ".md");

    // Get the base directory (before .kiro)
    const pathParts = this.filePath.split(path.sep);
    const kiroIndex = pathParts.lastIndexOf(".kiro");
    const baseDir = pathParts.slice(0, kiroIndex).join(path.sep) || ".";

    // Create filename for Rulesync
    const rulesyncFilename = `kiro-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter based on steering document type
    const frontmatter: Record<string, unknown> = {
      target: "kiro" as const,
      description: this.getDescriptionForSteeringType(filename),
    };

    // Add steering type for reference
    frontmatter.steeringType = filename;

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
   * Get description for steering document type
   */
  private getDescriptionForSteeringType(steeringType: string): string {
    switch (steeringType) {
      case "product":
        return "Kiro product steering document - target users, UX rules, release criteria";
      case "structure":
        return "Kiro structure steering document - repository layout, module boundaries";
      case "tech":
        return "Kiro tech steering document - language versions, frameworks, coding standards";
      default:
        return `Kiro steering document - ${steeringType}`;
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
      kiroFilePathSchema.parse(this.filePath);

      // Validate content
      kiroContentSchema.parse(this.content);

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
