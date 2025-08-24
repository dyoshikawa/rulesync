import { promises as fs } from "node:fs";
import path from "node:path";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import { RulesyncRule } from "../RulesyncRule.js";
import { cursorContentSchema, cursorFilePathSchema } from "../schemas.js";
import type { ToolRule, ValidationResult } from "../types.js";

/**
 * Cursor rule implementation
 *
 * Cursor uses project rules through .mdc (Markdown with Context) files
 * in the `.cursor/rules/` directory structure.
 */
export class CursorRule implements ToolRule {
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
   * Build a CursorRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): CursorRule {
    const { filePath, fileContent } = params;
    return new CursorRule({
      filePath,
      content: fileContent,
    });
  }

  /**
   * Load a CursorRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<CursorRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return CursorRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Create a CursorRule from a RulesyncRule
   */
  static fromRulesyncRule(rulesyncRule: RulesyncRule): CursorRule {
    const content = rulesyncRule.getContent().trim();
    const frontmatter = rulesyncRule.getFrontmatter();

    // Determine the file path based on whether it's a root rule or detail rule
    const originalPath = rulesyncRule.getFilePath();
    const dir = path.dirname(originalPath);
    const filename = path.basename(originalPath, path.extname(originalPath));

    // Cursor uses .cursor/rules/ directory structure
    // Root rules go to the main .cursor/rules/ directory
    // Detail rules also go there (no subdirectories within rules/)
    const isRootRule = frontmatter.root === true;
    const ruleName = isRootRule ? "project-rules" : filename;
    const cursorPath = path.join(dir, ".cursor", "rules", `${ruleName}.mdc`);

    // Build Cursor frontmatter
    const cursorFrontmatter: string[] = ["---"];

    // Add description
    if (frontmatter.description) {
      cursorFrontmatter.push(`description: "${frontmatter.description}"`);
    }

    // Add globs pattern if present
    if (frontmatter.glob) {
      const globPattern = Array.isArray(frontmatter.glob)
        ? frontmatter.glob.join(", ")
        : frontmatter.glob;
      cursorFrontmatter.push(`globs: "${globPattern}"`);
    }

    // Add alwaysApply flag based on root status
    cursorFrontmatter.push(`alwaysApply: ${isRootRule}`);

    cursorFrontmatter.push("---", "");
    const cursorContent = cursorFrontmatter.join("\n") + content;

    return new CursorRule({
      filePath: cursorPath,
      content: cursorContent,
    });
  }

  /**
   * Convert to RulesyncRule format
   */
  toRulesyncRule(): RulesyncRule {
    // Parse Cursor frontmatter
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
    let description = "";
    let globs = "";
    let alwaysApply = false;

    for (const line of frontmatterLines) {
      const match = line.match(/^(\w+):\s*"?(.+?)"?$/);
      if (match) {
        const [, key, value] = match;
        if (key === "description" && value) {
          description = value.replace(/^["']|["']$/g, "");
        } else if (key === "globs" && value) {
          globs = value.replace(/^["']|["']$/g, "");
        } else if (key === "alwaysApply" && value) {
          alwaysApply = value.trim() === "true";
        }
      }
    }

    // Extract content without frontmatter
    const mainContent =
      contentStartIndex > 0
        ? lines.slice(contentStartIndex).join("\n").trim()
        : this.content.trim();

    // Determine if this is a root rule based on file name or alwaysApply
    const filename = path.basename(this.filePath, ".mdc");
    const isRootRule = filename === "project-rules" || alwaysApply;

    // Extract the directory from the cursor path
    const pathParts = this.filePath.split(path.sep);
    const cursorIndex = pathParts.lastIndexOf(".cursor");

    // Get the base directory (before .cursor)
    const baseDir = pathParts.slice(0, cursorIndex).join(path.sep) || ".";

    const rulesyncFilename = isRootRule ? "cursor-root-rule" : `cursor-${filename}`;
    const rulesyncPath = path.join(baseDir, `${rulesyncFilename}.md`);

    // Create frontmatter for the Rulesync rule
    const frontmatter: Record<string, unknown> = {
      target: "cursor" as const,
      description:
        description || (isRootRule ? "Cursor project rules" : `Cursor rules - ${filename}`),
    };

    if (isRootRule) {
      frontmatter.root = true;
    }

    if (globs) {
      frontmatter.glob = globs;
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
      cursorFilePathSchema.parse(this.filePath);

      // Validate content
      cursorContentSchema.parse(this.content);

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
