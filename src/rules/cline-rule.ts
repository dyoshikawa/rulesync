import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

// Cline rules don't have frontmatter, they're plain Markdown files
// But we need a schema for consistency with other rule types
export const ClineRuleFrontmatterSchema = z.object({
  // Cline rules don't have frontmatter, but we track metadata internally
  description: z.optional(z.string()),
});

export type ClineRuleFrontmatter = z.infer<typeof ClineRuleFrontmatterSchema>;

export interface ClineRuleParams extends AiFileParams {
  frontmatter: ClineRuleFrontmatter;
  body: string;
}

export class ClineRule extends ToolRule {
  private readonly frontmatter: ClineRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClineRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = ClineRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const targets: ToolTargets = ["cline"];
    // Extract description from filename or first heading if not provided
    const description = this.frontmatter.description || this.extractDescription();

    const rulesyncFrontmatter = {
      targets,
      root: false,
      description,
      globs: [], // Cline rules don't use globs
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    relativeDirPath,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ClineRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    // Cline rules don't have frontmatter, so we only track description internally
    const clineFrontmatter: ClineRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // For Cline, the file content is just the body (no frontmatter)
    const body = rulesyncRule.getBody();
    const fileContent = body; // Plain Markdown for Cline

    return new ClineRule({
      baseDir: baseDir,
      frontmatter: clineFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<ClineRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    // Cline files are plain Markdown without frontmatter
    // Check if there's accidental frontmatter (shouldn't be there for Cline)
    const parsed = matter(fileContent);

    // If frontmatter exists, it's likely a mistake - use the full content as body
    const hasActualFrontmatter = Object.keys(parsed.data).length > 0;
    const body = hasActualFrontmatter ? fileContent : parsed.content.trim();

    // Extract description from content first, then filename as fallback
    const description =
      ClineRule.extractDescriptionFromContent(body) ||
      ClineRule.extractDescriptionFromPath(relativeFilePath);

    const frontmatter: ClineRuleFrontmatter = {
      description,
    };

    // Validate frontmatter if needed
    if (validate) {
      const result = ClineRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
      }
    }

    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter,
      body,
      fileContent: body, // For Cline, fileContent is just the body
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClineRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): ClineRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  private extractDescription(): string {
    // Try to extract description from the first heading or filename
    const headingMatch = this.body.match(/^#\s+(.+)$/m);
    if (headingMatch && headingMatch[1]) {
      return headingMatch[1];
    }

    // Fall back to filename-based description
    return ClineRule.extractDescriptionFromPath(this.relativeFilePath) || "Cline rule";
  }

  private static extractDescriptionFromPath(filePath: string): string | undefined {
    // Extract description from filename (e.g., "01-coding-style.md" -> "Coding style")
    const filename = filePath.split("/").pop() || "";
    const nameWithoutExt = filename.replace(/\.(md|mdx)$/, "");
    const nameWithoutPrefix = nameWithoutExt.replace(/^\d+[-_]/, "");

    if (nameWithoutPrefix) {
      // Convert kebab-case or snake_case to sentence case
      return nameWithoutPrefix.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }

    return undefined;
  }

  private static extractDescriptionFromContent(content: string): string | undefined {
    // Try to extract description from the first heading
    const headingMatch = content.match(/^#\s+(.+)$/m);
    if (headingMatch) {
      return headingMatch[1];
    }

    // Try to get first non-empty line as description
    const lines = content.split("\n").filter((line) => line.trim());
    if (lines.length > 0) {
      const firstLine = lines[0];
      // If it's a reasonable length for a description
      if (firstLine && firstLine.length < 100) {
        return firstLine.replace(/^[#*-]\s*/, "").trim();
      }
    }

    return undefined;
  }
}
