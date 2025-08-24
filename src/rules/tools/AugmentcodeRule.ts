import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { augmentcodeContentSchema, augmentcodeFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * AugmentCode rule implementation
 *
 * AugmentCode uses a rules system to provide project-specific instructions
 * through structured Markdown files in the `.augment/rules/` directory.
 */
export class AugmentcodeRule implements ToolRule {
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
   * Build an AugmentcodeRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): AugmentcodeRule {
    const { filePath, fileContent } = params;
    return new AugmentcodeRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load an AugmentcodeRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<AugmentcodeRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return AugmentcodeRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create an AugmentcodeRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): AugmentcodeRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on rule type
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // AugmentCode uses .augment/rules/ directory for all rules
    // File naming convention based on type (from frontmatter)
    const isRootRule = frontmatter.root === true;

    // Determine rule type for AugmentCode
    let ruleType = "manual"; // default
    let suffix = "-manual";

    if (isRootRule) {
      // Root rules are typically "always" rules in AugmentCode
      ruleType = "always";
      suffix = "-always";
    } else if (frontmatter.auto === true) {
      ruleType = "auto";
      suffix = "-auto";
    }

    const augmentcodePath = path.join(dir, ".augment", "rules", `${filename}${suffix}.md`);

    // Build AugmentCode frontmatter
    const augmentcodeFrontmatter: string[] = ["---"];
    augmentcodeFrontmatter.push(`type: ${ruleType}`);

    if (ruleType === "always") {
      augmentcodeFrontmatter.push('description: ""');
    } else {
      const description = frontmatter.description || `${filename} rules`;
      // Quote string values that contain special characters
      const formattedDescription =
        description.includes(":") || description.includes("-") ? `"${description}"` : description;
      augmentcodeFrontmatter.push(`description: ${formattedDescription}`);
    }

    // Add tags if present
    if (frontmatter.tags && Array.isArray(frontmatter.tags)) {
      augmentcodeFrontmatter.push(`tags: [${frontmatter.tags.join(", ")}]`);
    }

    augmentcodeFrontmatter.push("---", "");

    // Combine frontmatter with content
    const augmentcodeContent = augmentcodeFrontmatter.join("\n") + content;

    return new AugmentcodeRule({
      filePath: augmentcodePath,
      content: augmentcodeContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Parse the AugmentCode frontmatter
    const lines = this.content.split("\n");
    let inFrontmatter = false;
    const frontmatterLines: string[] = [];
    let contentStartIndex = 0;

    for (let i = 0; i < lines.length; i++) {
      const line = lines[i];
      if (line === "---") {
        if (!inFrontmatter) {
          inFrontmatter = true;
        } else {
          contentStartIndex = i + 1;
          break;
        }
      } else if (inFrontmatter && line !== undefined) {
        frontmatterLines.push(line);
      }
    }

    // Parse frontmatter
    let ruleType = "manual";
    let description = "";
    let tags: string[] = [];

    for (const line of frontmatterLines) {
      const match = line.match(/^(\w+):\s*(.+)$/);
      if (match) {
        const [, key, matchedValue] = match;
        if (key === "type" && matchedValue) {
          ruleType = matchedValue.trim();
        } else if (key === "description" && matchedValue) {
          description = matchedValue.replace(/^["']|["']$/g, "").trim();
        } else if (key === "tags" && matchedValue) {
          // Parse tags array
          const tagsMatch = matchedValue.match(/\[(.+)\]/);
          if (tagsMatch && tagsMatch[1]) {
            tags = tagsMatch[1].split(",").map((t) => t.trim());
          }
        }
      }
    }

    // Extract content without frontmatter
    const mainContent = lines.slice(contentStartIndex).join("\n").trim();

    // Extract the directory from the augmentcode path
    const pathParts = this.filePath.split(path.sep);
    const augmentIndex = pathParts.lastIndexOf(".augment");

    // Get the base directory (before .augment)
    const baseDir = pathParts.slice(0, augmentIndex).join(path.sep) || ".";
    const filename = path.basename(this.filePath, ".md");

    // Remove type suffix from filename
    const cleanFilename = filename.replace(/-(always|manual|auto)$/, "");

    // Determine if this is a root rule based on type
    const isRootRule = ruleType === "always";
    const rulesyncFilename = isRootRule
      ? `augmentcode-${cleanFilename}-root`
      : `augmentcode-${cleanFilename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter for the Rulesync rule
    const frontmatter: Record<string, unknown> = {
      target: "augmentcode" as const,
      description:
        description ||
        (isRootRule
          ? "Project-level rules for AugmentCode"
          : `AugmentCode rules - ${cleanFilename}`),
    };

    if (isRootRule) {
      frontmatter.root = true;
    } else if (ruleType === "auto") {
      frontmatter.auto = true;
    }

    if (tags.length > 0) {
      frontmatter.tags = tags;
    }

    // Create the Rulesync rule with frontmatter
    const rulesyncFrontmatterLines = ["---"];
    for (const [key, value] of Object.entries(frontmatter)) {
      if (Array.isArray(value)) {
        rulesyncFrontmatterLines.push(`${key}: [${value.join(", ")}]`);
      } else if (typeof value === "string" && (value.includes(":") || value.includes("-"))) {
        rulesyncFrontmatterLines.push(`${key}: "${value}"`);
      } else {
        rulesyncFrontmatterLines.push(`${key}: ${value}`);
      }
    }
    rulesyncFrontmatterLines.push("---", "");

    const fileContent = rulesyncFrontmatterLines.join("\n") + mainContent;

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
      augmentcodeFilePathSchema.parse(this.filePath);

      // Validate content
      augmentcodeContentSchema.parse(this.content);

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
