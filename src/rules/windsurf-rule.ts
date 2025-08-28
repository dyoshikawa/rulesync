import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const WindsurfRuleFrontmatterSchema = z.object({
  description: z.string(),
  activationMode: z.optional(z.enum(["always", "manual", "model-decision", "glob"])),
  globPattern: z.optional(z.string()),
});

export type WindsurfRuleFrontmatter = z.infer<typeof WindsurfRuleFrontmatterSchema>;

export interface WindsurfRuleParams extends AiFileParams {
  frontmatter: WindsurfRuleFrontmatter;
  body: string;
}

/**
 * WindsurfRule - Windsurf AI Code Editor rules configuration
 *
 * Handles Windsurf-specific rule files with support for:
 * - Global rules in ~/.codeium/windsurf/memories/global_rules.md
 * - Workspace rules in .windsurf-rules or .windsurf/rules/
 * - Activation modes (always, manual, model-decision, glob)
 */
export class WindsurfRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: WindsurfRuleFrontmatter;

  constructor(params: WindsurfRuleParams) {
    super({
      ...params,
    });
    this.body = params.body;
    this.frontmatter = params.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<WindsurfRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { data, content } = matter(fileContent);

    // Validate frontmatter, provide default if empty
    const frontmatter = WindsurfRuleFrontmatterSchema.parse(
      data.description ? data : { description: "" },
    );

    return new WindsurfRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body: content,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    relativeDirPath,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ToolRule {
    const rulesyncFrontmatter = rulesyncRule.getFrontmatter();
    const windsurfFrontmatter: WindsurfRuleFrontmatter = {
      description: rulesyncFrontmatter.description || "",
      activationMode: this.mapActivationMode(rulesyncFrontmatter),
      globPattern: rulesyncFrontmatter.globs?.join("|"),
    };

    // Generate proper file content with Windsurf specific frontmatter
    const body = rulesyncRule.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(windsurfFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    return new WindsurfRule({
      baseDir: baseDir,
      frontmatter: windsurfFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  /**
   * Map rulesync frontmatter to Windsurf activation mode
   */
  private static mapActivationMode(
    frontmatter: RuleFrontmatter,
  ): "always" | "manual" | "model-decision" | "glob" | undefined {
    // If globs are specified, use glob mode
    if (frontmatter.globs && frontmatter.globs.length > 0) {
      return "glob";
    }

    // If no description, default to manual
    if (!frontmatter.description || frontmatter.description.trim() === "") {
      return "manual";
    }

    // Default to always-on for rules with descriptions
    return "always";
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["windsurf"] as const,
      description: this.frontmatter.description,
      globs: this.frontmatter.globPattern?.split("|") || [],
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

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = WindsurfRuleFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  /**
   * Get the activation mode for Windsurf
   */
  getActivationMode(): string {
    return this.frontmatter.activationMode || "always";
  }

  /**
   * Get the glob pattern if specified
   */
  getGlobPattern(): string | undefined {
    return this.frontmatter.globPattern;
  }

  /**
   * Check if rule should be applied based on activation mode
   */
  shouldActivate(context?: { filePattern?: string }): boolean {
    const mode = this.getActivationMode();

    switch (mode) {
      case "always":
        return true;
      case "manual":
        return false; // Only activated when explicitly mentioned
      case "model-decision":
        return true; // Let model decide (always available)
      case "glob":
        if (!context?.filePattern || !this.frontmatter.globPattern) {
          return false;
        }
        // Simple glob matching - in real implementation, use a proper glob library
        return context.filePattern.includes(this.frontmatter.globPattern);
      default:
        return true;
    }
  }

  /**
   * Get the rule body content
   */
  getBody(): string {
    return this.body;
  }
}
