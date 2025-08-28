import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const ClineRuleFrontmatterSchema = z.object({
  description: z.string(),
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

  getFrontmatter(): ClineRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      targets: ["cline"] as const,
      root: false,
      description: this.frontmatter.description,
      globs: [],
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      baseDir: this.getBaseDir(),
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
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const clineFrontmatter: ClineRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content - Cline uses plain Markdown without frontmatter
    const body = rulesyncRule.getBody();
    const fileContent = body; // No frontmatter for Cline files

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
    // We need to extract a description from the content or filename
    const body = fileContent.trim();

    // Try to extract description from first heading or use filename
    let description = "";
    const firstHeading = body.match(/^#\s+(.+)$/m);
    if (firstHeading && firstHeading[1]) {
      description = firstHeading[1].trim();
    } else {
      // Generate description from filename
      const filename = basename(relativeFilePath, ".md");
      description = filename.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }

    if (!description) {
      description = "Cline rule";
    }

    const frontmatter: ClineRuleFrontmatter = {
      description,
    };

    return new ClineRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter,
      body,
      fileContent,
      validate,
    });
  }
}
