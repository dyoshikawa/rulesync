import { promises as fs } from "node:fs";
import path from "node:path";
import matter from "gray-matter";
// eslint-disable-next-line zod-import/zod-import
import { z } from "zod";
import {
  type RulesyncFrontmatter,
  rulesyncContentSchema,
  rulesyncFrontmatterSchema,
} from "./schemas.js";
import { Rule, ValidationResult } from "./types.js";

/**
 * Implementation of Rulesync's unified rule format
 */
export class RulesyncRule implements Rule {
  private filePath: string;
  private frontmatter: RulesyncFrontmatter;
  private content: string;

  private constructor(params: {
    filePath: string;
    frontmatter: RulesyncFrontmatter;
    content: string;
  }) {
    this.filePath = params.filePath;
    this.frontmatter = params.frontmatter;
    this.content = params.content;
  }

  /**
   * Build a RulesyncRule from file path and content
   */
  static build(params: { filePath: string; fileContent: string }): RulesyncRule {
    const { filePath, fileContent } = params;
    const parsed = matter(fileContent);

    return new RulesyncRule({
      filePath,
      frontmatter: parsed.data,
      content: parsed.content,
    });
  }

  /**
   * Load a RulesyncRule from a file path
   */
  static async fromFilePath(filePath: string): Promise<RulesyncRule> {
    const absolutePath = path.resolve(filePath);
    const fileContent = await fs.readFile(absolutePath, "utf-8");
    return RulesyncRule.build({ filePath: absolutePath, fileContent });
  }

  /**
   * Write the rule to the file system
   */
  async writeFile(): Promise<void> {
    const dir = path.dirname(this.filePath);
    await fs.mkdir(dir, { recursive: true });

    const fileContent = this.getFileContent();
    await fs.writeFile(this.filePath, fileContent, "utf-8");
  }

  /**
   * Validate the rule content using zod schemas
   */
  validate(): ValidationResult {
    try {
      // Validate content
      rulesyncContentSchema.parse(this.content);

      // Validate frontmatter
      rulesyncFrontmatterSchema.parse(this.frontmatter);

      return { success: true, error: null };
    } catch (error) {
      if (error instanceof z.ZodError) {
        // Special handling for target validation
        const targetIssue = error.issues.find((e) => e.path.includes("target"));
        if (targetIssue && this.frontmatter.target) {
          return {
            success: false,
            error: new Error(`Invalid target: ${this.frontmatter.target}`),
          };
        }

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
   * Get the file content with frontmatter
   */
  getFileContent(): string {
    const frontmatterContent =
      Object.keys(this.frontmatter).length > 0
        ? matter.stringify(this.content, this.frontmatter)
        : this.content;

    return frontmatterContent;
  }

  /**
   * Get the frontmatter
   */
  getFrontmatter(): RulesyncFrontmatter {
    return { ...this.frontmatter };
  }

  /**
   * Get the content without frontmatter
   */
  getContent(): string {
    return this.content;
  }

  /**
   * Update the frontmatter
   */
  setFrontmatter(frontmatter: RulesyncFrontmatter): void {
    this.frontmatter = { ...frontmatter };
  }

  /**
   * Update the content
   */
  setContent(content: string): void {
    this.content = content;
  }

  /**
   * Update the file path
   */
  setFilePath(filePath: string): void {
    this.filePath = filePath;
  }
}
