import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { copilotContentSchema, copilotFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * GitHub Copilot rule implementation
 *
 * GitHub Copilot uses custom instructions through Markdown files
 * in the `.github/` directory structure.
 */
export class CopilotRule implements ToolRule {
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
   * Build a CopilotRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): CopilotRule {
    const { filePath, fileContent } = params;
    return new CopilotRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a CopilotRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<CopilotRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return CopilotRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a CopilotRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): CopilotRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // GitHub Copilot uses .github/ directory structure
    // Root rules become copilot-instructions.md, detail rules go to instructions/
    const isRootRule = frontmatter.root === true;
    const copilotPath = isRootRule
      ? path.join(dir, ".github", "copilot-instructions.md")
      : path.join(dir, ".github", "instructions", `${filename}.instructions.md`);

    // Build Copilot frontmatter if it's a detail rule
    let copilotContent = content;
    if (!isRootRule) {
      const copilotFrontmatter: string[] = ["---"];

      // Add description if present
      if (frontmatter.description) {
        copilotFrontmatter.push(`description: "${frontmatter.description}"`);
      }

      // Add applyTo pattern (use glob if present, otherwise default to all)
      const applyTo = frontmatter.glob || "**";
      copilotFrontmatter.push(`applyTo: "${applyTo}"`);

      copilotFrontmatter.push("---", "");
      copilotContent = copilotFrontmatter.join("\n") + content;
    }

    return new CopilotRule({
      filePath: copilotPath,
      content: copilotContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Parse Copilot frontmatter if present
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

    // Parse frontmatter if present
    let description = "";
    let applyTo = "";

    if (contentStartIndex > 0) {
      for (const line of frontmatterLines) {
        const match = line.match(/^(\w+):\s*"?(.+?)"?$/);
        if (match) {
          const [, key, value] = match;
          if (key === "description" && value) {
            description = value.replace(/^["']|["']$/g, "");
          } else if (key === "applyTo" && value) {
            applyTo = value.replace(/^["']|["']$/g, "");
          }
        }
      }
    }

    // Extract content without frontmatter
    const mainContent =
      contentStartIndex > 0
        ? lines.slice(contentStartIndex).join("\n").trim()
        : this.content.trim();

    // Determine if this is a root rule based on file path
    const isRootRule = this.filePath.endsWith("copilot-instructions.md");

    // Extract the directory from the copilot path
    const pathParts = this.filePath.split(path.sep);
    const githubIndex = pathParts.lastIndexOf(".github");

    // Get the base directory (before .github)
    const baseDir = pathParts.slice(0, githubIndex).join(path.sep) || ".";
    const filename = path.basename(this.filePath, ".instructions.md").replace(".md", "");

    const rulesyncFilename = isRootRule ? "copilot-root-rule" : `copilot-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter for the Rulesync rule
    const frontmatter: Record<string, unknown> = {
      target: "copilot" as const,
      description:
        description ||
        (isRootRule
          ? "GitHub Copilot custom instructions"
          : `GitHub Copilot instructions - ${filename}`),
    };

    if (isRootRule) {
      frontmatter.root = true;
    }

    if (applyTo && applyTo !== "**") {
      frontmatter.glob = applyTo;
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
      copilotFilePathSchema.parse(this.filePath);

      // Validate content
      copilotContentSchema.parse(this.content);

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
