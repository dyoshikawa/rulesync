import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const RooRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type RooRuleFrontmatter = z.infer<typeof RooRuleFrontmatterSchema>;

export interface RooRuleParams extends AiFileParams {
  frontmatter: RooRuleFrontmatter;
  body: string;
  mode: string | undefined; // Mode extracted from path, can be undefined
}

/**
 * Rule generator for Roo Code AI assistant
 *
 * Generates rule files for Roo Code's hierarchical rule system.
 * Supports plain Markdown without frontmatter, mode-specific rules,
 * and both directory-based and single-file configurations.
 */
export class RooRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: RooRuleFrontmatter;
  private readonly mode: string | undefined;

  constructor({ frontmatter, body, mode, ...rest }: RooRuleParams) {
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = RooRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.mode = mode;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<RooRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    // Roo Code uses plain Markdown without frontmatter
    const body = fileContent.trim();

    // Extract description from first heading or filename
    let description = "";
    const firstHeading = body.match(/^#\s+(.+)$/m);
    if (firstHeading && firstHeading[1]) {
      description = firstHeading[1].trim();
    } else {
      // Generate description from filename
      const filename = basename(params.relativeFilePath, ".md");
      description = filename.replace(/[-_]/g, " ").replace(/\b\w/g, (char) => char.toUpperCase());
    }

    if (!description) {
      description = "Roo rule";
    }

    // Extract mode from file path if it's mode-specific
    const mode = RooRule.extractModeFromPath(params.relativeFilePath);

    const frontmatter: RooRuleFrontmatter = {
      description,
    };

    return new RooRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body,
      mode,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): RooRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;
    
    // Extract mode from file path if it's mode-specific
    const mode = RooRule.extractModeFromPath(rulesyncRule.getRelativeFilePath());

    return new RooRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: { description },
      body: rulesyncRule.getBody(),
      mode,
    });
  }

  /**
   * Extract mode slug from file path for mode-specific rules
   * Returns undefined for non-mode-specific rules
   */
  static extractModeFromPath(filePath: string): string | undefined {
    // Check for mode-specific patterns:
    // .roo/rules-{mode}/ or .roorules-{mode} or .clinerules-{mode}
    
    // Directory pattern: .roo/rules-{mode}/
    const directoryMatch = filePath.match(/\.roo\/rules-([a-zA-Z0-9-]+)\//);
    if (directoryMatch) {
      return directoryMatch[1];
    }

    // Single-file patterns: .roorules-{mode} or .clinerules-{mode}
    const singleFileMatch = filePath.match(/\.(roo|cline)rules-([a-zA-Z0-9-]+)$/);
    if (singleFileMatch) {
      return singleFileMatch[2];
    }

    return undefined;
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["roo"],
      description: this.frontmatter.description,
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: this.getRelativeDirPath(),
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RooRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: result.error };
    }
      
    // Validate mode slug if present
    if (this.mode && !/^[a-zA-Z0-9-]+$/.test(this.mode)) {
      return {
        success: false,
        error: new Error(`Invalid mode slug: ${this.mode}. Must match pattern: ^[a-zA-Z0-9-]+$`),
      };
    }

    return { success: true, error: null };
  }

  /**
   * Get the mode associated with this rule (if any)
   */
  getMode(): string | undefined {
    return this.mode;
  }

  /**
   * Get the output file path for the generated rule file
   * Preserves the original path structure for Roo Code compatibility
   */
  getOutputFilePath(): string {
    return this.getRelativeFilePath();
  }

  /**
   * Get the content that should be written to the output file
   * Roo Code uses plain Markdown without frontmatter
   */
  getOutputContent(): string {
    return this.body;
  }

  /**
   * Determine if this rule is directory-based vs single-file
   */
  isDirectoryBased(): boolean {
    return this.getRelativeFilePath().includes(".roo/rules");
  }

  /**
   * Determine if this rule is mode-specific
   */
  isModeSpecific(): boolean {
    return this.mode !== undefined;
  }

  /**
   * Determine if this rule uses legacy naming (.clinerules)
   */
  isLegacyRule(): boolean {
    return this.getRelativeFilePath().includes(".clinerules");
  }

  /**
   * Get rule type for debugging/logging purposes
   */
  getRuleType(): string {
    const parts: string[] = [];
    
    if (this.isDirectoryBased()) {
      parts.push("directory");
    } else {
      parts.push("single-file");
    }
    
    if (this.isModeSpecific()) {
      parts.push(`mode:${this.mode}`);
    }
    
    if (this.isLegacyRule()) {
      parts.push("legacy");
    }
    
    return parts.join(" ");
  }
}