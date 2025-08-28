import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ToolTargets } from "../types/tool-targets.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const CopilotRuleFrontmatterSchema = z.object({
  description: z.string(),
  applyTo: z.optional(z.string()),
});

export type CopilotRuleFrontmatter = z.infer<typeof CopilotRuleFrontmatterSchema>;

export interface CopilotRuleParams extends AiFileParams {
  frontmatter: CopilotRuleFrontmatter;
  body: string;
}

export class CopilotRule extends ToolRule {
  private readonly frontmatter: CopilotRuleFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    // Set default value for applyTo if not provided
    this.frontmatter = frontmatter
      ? {
          ...frontmatter,
          applyTo: frontmatter.applyTo || "**",
        }
      : frontmatter;
    this.body = body;
  }

  toRulesyncRule(): RulesyncRule {
    const targets: ToolTargets = ["copilot"];
    const rulesyncFrontmatter = {
      targets,
      root: false,
      description: this.frontmatter.description,
      globs: this.frontmatter.applyTo ? [this.frontmatter.applyTo] : ["**"],
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
  }: ToolRuleFromRulesyncRuleParams): CopilotRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();

    const copilotFrontmatter: CopilotRuleFrontmatter = {
      description: rulesyncFrontmatter.description,
      applyTo: rulesyncFrontmatter.globs.length > 0 ? rulesyncFrontmatter.globs.join(",") : "**",
    };

    // Generate proper file content with Copilot specific frontmatter
    const body = rulesyncRule.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(copilotFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    // Generate filename with .instructions.md extension
    const originalFileName = rulesyncRule.getRelativeFilePath();
    const nameWithoutExt = originalFileName.replace(/\.md$/, "");
    const newFileName = `${nameWithoutExt}.instructions.md`;

    return new CopilotRule({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
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
  }: AiFileFromFilePathParams): Promise<CopilotRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using CopilotRuleFrontmatterSchema
    const result = CopilotRuleFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CopilotRule({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: {
        ...result.data,
        applyTo: result.data.applyTo || "**",
      },
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

    const result = CopilotRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  getFrontmatter(): CopilotRuleFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }
}
