import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { ToolTargets } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const AugmentcodeLegacyRuleFrontmatterSchema = z.object({
  type: z.optional(z.enum(["always", "manual", "auto"])),
  description: z.optional(z.string()),
  tags: z.optional(z.array(z.string())),
});

export type AugmentcodeLegacyRuleFrontmatter = z.infer<
  typeof AugmentcodeLegacyRuleFrontmatterSchema
>;

export interface AugmentcodeLegacyRuleParams extends AiFileParams {
  frontmatter: AugmentcodeLegacyRuleFrontmatter;
  body: string;
  root?: boolean;
}

export class AugmentcodeLegacyRule extends ToolRule {
  private readonly frontmatter: AugmentcodeLegacyRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, root, ...rest }: AugmentcodeLegacyRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = AugmentcodeLegacyRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      ...(root !== undefined && { root }),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const targets: ToolTargets = ["augmentcode"];
    const globs: string[] = [];
    const rulesyncFrontmatter = {
      targets,
      root: this.isRoot(),
      description: this.frontmatter.description || "",
      globs,
      ...(this.frontmatter.tags && { tags: this.frontmatter.tags }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      fileContent,
      validate: false,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    relativeDirPath: _relativeDirPath,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const root = rulesyncFrontmatter.root;
    const augmentcodeFrontmatter: AugmentcodeLegacyRuleFrontmatter = {
      // Legacy format doesn't use type field, but we can infer it
      type: "always",
      description: rulesyncFrontmatter.description,
      tags: rulesyncFrontmatter.tags,
    };

    // Generate proper file content without frontmatter for legacy format
    const body = rulesyncRule.getBody();
    const fileContent = body; // Legacy format is plain Markdown without frontmatter

    if (root) {
      return new AugmentcodeLegacyRule({
        baseDir,
        frontmatter: augmentcodeFrontmatter,
        body,
        relativeDirPath: ".",
        relativeFilePath: ".augment-guidelines",
        fileContent,
        validate,
        root,
      });
    }

    return new AugmentcodeLegacyRule({
      baseDir,
      frontmatter: augmentcodeFrontmatter,
      body,
      relativeDirPath: join(".augment", "rules"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
      root,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = AugmentcodeLegacyRuleFrontmatterSchema.safeParse(this.frontmatter);
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
  }: AiFileFromFilePathParams): Promise<AugmentcodeLegacyRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    // Try to parse frontmatter, but it might not exist in legacy files
    const { data: frontmatter, content } = matter(fileContent);

    // For legacy format, frontmatter might be empty, so we use defaults
    const augmentcodeFrontmatter: AugmentcodeLegacyRuleFrontmatter = {
      type: frontmatter.type || "always",
      description: frontmatter.description || "",
      tags: frontmatter.tags || [],
    };

    // Validate frontmatter using schema if validate is true
    if (validate) {
      const result = AugmentcodeLegacyRuleFrontmatterSchema.safeParse(augmentcodeFrontmatter);
      if (!result.success) {
        throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
      }
    }

    // Determine if it's a root file
    const isRoot = relativeFilePath === ".augment-guidelines" && relativeDirPath === ".";

    return new AugmentcodeLegacyRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: augmentcodeFrontmatter,
      body: content.trim(),
      fileContent,
      validate,
      root: isRoot,
    });
  }

  /**
   * Generate legacy .augment-guidelines content
   * This method is used to convert modern rule format to legacy format
   */
  private generateLegacyGuidelines(): string {
    // Legacy format is plain Markdown without frontmatter
    return this.body;
  }

  /**
   * Get the frontmatter for this rule
   */
  getFrontmatter(): AugmentcodeLegacyRuleFrontmatter {
    return this.frontmatter;
  }

  /**
   * Get the body content for this rule
   */
  getBody(): string {
    return this.body;
  }
}
