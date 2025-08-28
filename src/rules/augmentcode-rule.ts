import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const AugmentcodeRuleFrontmatterSchema = z.object({
  type: z.enum(["always", "manual", "auto"]),
  description: z.string(),
  tags: z.optional(z.array(z.string())),
});

export type AugmentcodeRuleFrontmatter = z.infer<typeof AugmentcodeRuleFrontmatterSchema>;

export interface AugmentcodeRuleParams extends AiFileParams {
  frontmatter: AugmentcodeRuleFrontmatter;
  body: string;
}

export class AugmentcodeRule extends ToolRule {
  private readonly frontmatter: AugmentcodeRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: AugmentcodeRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = AugmentcodeRuleFrontmatterSchema.safeParse(frontmatter);
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
    const targets: ToolTargets = ["augmentcode"];
    const rulesyncFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs: [],
      ...(this.frontmatter.tags && { tags: this.frontmatter.tags }),
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
  }: ToolRuleFromRulesyncRuleParams): AugmentcodeRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    // Determine rule type based on targets and metadata
    const type = AugmentcodeRule.determineRuleType(rulesyncRule);

    const augmentcodeFrontmatter: AugmentcodeRuleFrontmatter = {
      type,
      description: rulesyncFrontmatter.description,
      ...(rulesyncFrontmatter.tags && { tags: rulesyncFrontmatter.tags }),
    };

    // Generate proper file content with AugmentCode specific frontmatter
    const body = rulesyncRule.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(augmentcodeFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    // Generate filename with type suffix
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}-${type}.md`;

    return new AugmentcodeRule({
      baseDir: baseDir,
      frontmatter: augmentcodeFrontmatter,
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
  }: AiFileFromFilePathParams): Promise<AugmentcodeRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using AugmentcodeRuleFrontmatterSchema
    const result = AugmentcodeRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new AugmentcodeRule({
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

    const result = AugmentcodeRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): AugmentcodeRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  /**
   * Determines the rule type based on RulesyncRule metadata
   */
  private static determineRuleType(rulesyncRule: RulesyncRule): "always" | "manual" | "auto" {
    const frontmatter = rulesyncRule.getFrontmatter();
    const body = rulesyncRule.getBody();

    // Check if the rule indicates it should be automatically applied
    const hasAutoTriggers =
      body.toLowerCase().includes("auto") ||
      body.toLowerCase().includes("automatic") ||
      (frontmatter.tags && frontmatter.tags.some((tag) => tag.toLowerCase().includes("auto")));

    if (hasAutoTriggers) {
      return "auto";
    }

    // Check if it's a basic rule that should always be applied
    const isAlwaysOn =
      frontmatter.root ||
      body.toLowerCase().includes("always") ||
      frontmatter.description.toLowerCase().includes("always");

    if (isAlwaysOn) {
      return "always";
    }

    // Default to manual
    return "manual";
  }
}
