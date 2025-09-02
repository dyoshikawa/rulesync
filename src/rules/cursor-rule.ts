import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const CursorRuleFrontmatterSchema = z.object({
  description: z.string(),
  globs: z.optional(z.string()),
  alwaysApply: z.optional(z.boolean()),
});

export type CursorRuleFrontmatter = z.infer<typeof CursorRuleFrontmatterSchema>;

export type CursorRuleParams = {
  frontmatter: CursorRuleFrontmatter;
  body: string;
} & AiFileParams;

export class CursorRule extends ToolRule {
  private readonly frontmatter: CursorRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CursorRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
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
    const targets: ToolTargets = ["cursor"];

    // Convert Cursor rule types to Rulesync format
    const isAlways = this.frontmatter.alwaysApply === true;
    const hasGlobs = this.frontmatter.globs && this.frontmatter.globs.trim() !== "";

    // Determine globs array
    let globs: string[];
    if (hasGlobs && this.frontmatter.globs) {
      // Split globs string by comma and trim whitespace
      globs = this.frontmatter.globs
        .split(",")
        .map((g) => g.trim())
        .filter((g) => g.length > 0);
    } else if (isAlways) {
      globs = ["**/*"];
    } else {
      globs = [];
    }

    const rulesyncFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    relativeDirPath,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CursorRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    // Determine Cursor rule properties from Rulesync frontmatter
    const isAlwaysGlob =
      rulesyncFrontmatter.globs.includes("**/*") && rulesyncFrontmatter.globs.length === 1;
    const alwaysApply = isAlwaysGlob;

    // Convert globs array back to string
    const globs = rulesyncFrontmatter.globs.length > 0 ? rulesyncFrontmatter.globs.join(",") : "";

    const cursorFrontmatter: CursorRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      globs: globs || undefined,
      alwaysApply: alwaysApply || undefined,
    };

    // Generate proper file content with Cursor specific frontmatter
    const body = rulesyncRule.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(cursorFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    // Generate filename with .mdc extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.mdc`;

    return new CursorRule({
      baseDir: baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: newFileName,
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
  }: AiFileFromFilePathParams): Promise<CursorRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using CursorRuleFrontmatterSchema
    const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CursorRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CursorRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): CursorRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }
}
