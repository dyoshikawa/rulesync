import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { RulesyncTargets } from "../types/tool-targets.js";
import { RulesyncRule, RulesyncRuleFrontmatter } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFilePathParams,
  ToolRuleFromRulesyncRuleParams,
} from "./tool-rule.js";

export const CursorRuleFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  globs: z.optional(z.string()),
  alwaysApply: z.optional(z.boolean()),
});

export type CursorRuleFrontmatter = z.infer<typeof CursorRuleFrontmatterSchema>;

export type CursorRuleParams = {
  frontmatter: CursorRuleFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class CursorRule extends ToolRule {
  private readonly frontmatter: CursorRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CursorRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate) {
      const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      fileContent: matter.stringify(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const targets: RulesyncTargets = ["*"];

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

    const rulesyncFrontmatter: RulesyncRuleFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs,
    };

    return new RulesyncRule({
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/rules",
      relativeFilePath: this.relativeFilePath,
      validate: true,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CursorRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    const cursorFrontmatter: CursorRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      globs:
        (rulesyncFrontmatter.globs?.length ?? 0 > 0)
          ? rulesyncFrontmatter.globs?.join(",")
          : undefined,
      alwaysApply: rulesyncFrontmatter.cursor?.alwaysApply ?? undefined,
    };

    // Generate proper file content with Cursor specific frontmatter
    const body = rulesyncRule.getBody();

    // Generate filename with .mdc extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.mdc`;

    return new CursorRule({
      baseDir: baseDir,
      frontmatter: cursorFrontmatter,
      body,
      relativeDirPath: ".cursor/rules",
      relativeFilePath: newFileName,
      validate,
    });
  }

  static async fromFilePath({
    filePath,
    validate = true,
  }: ToolRuleFromFilePathParams): Promise<CursorRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using CursorRuleFrontmatterSchema
    const result = CursorRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CursorRule({
      baseDir: ".",
      relativeDirPath: ".cursor/rules",
      relativeFilePath: basename(filePath),
      frontmatter: result.data,
      body: content.trim(),
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
