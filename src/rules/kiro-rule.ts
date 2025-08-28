import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const KiroRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type KiroRuleFrontmatter = z.infer<typeof KiroRuleFrontmatterSchema>;

export interface KiroRuleParams extends AiFileParams {
  frontmatter: KiroRuleFrontmatter;
  body: string;
  documentType: "product" | "structure" | "tech";
}

/**
 * Rule generator for Kiro AI-powered IDE
 *
 * Generates steering documents for Kiro's spec-driven development approach.
 * Unlike traditional rule files, Kiro uses multiple steering documents
 * (product.md, structure.md, tech.md) in the .kiro/steering/ directory.
 */
export class KiroRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: KiroRuleFrontmatter;
  private readonly documentType: "product" | "structure" | "tech";

  constructor(params: KiroRuleParams) {
    const { frontmatter, body, documentType, ...rest } = params;
    // Set properties before calling super to ensure they're available for validation
    if (rest.validate !== false) {
      const result = KiroRuleFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.documentType = documentType;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<KiroRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    // Kiro uses plain Markdown without frontmatter for steering documents
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
      description = "Kiro steering document";
    }

    // Extract document type from filename
    const documentType = KiroRule.extractDocumentTypeFromPath(params.relativeFilePath);

    const frontmatter: KiroRuleFrontmatter = {
      description,
    };

    return new KiroRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body,
      documentType,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): KiroRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;

    // Extract document type from file path
    const documentType = KiroRule.extractDocumentTypeFromPath(rulesyncRule.getRelativeFilePath());

    return new KiroRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: { description },
      body: rulesyncRule.getBody(),
      documentType,
    });
  }

  /**
   * Extract document type from file path
   * Returns document type based on filename or defaults to "tech"
   */
  static extractDocumentTypeFromPath(filePath: string): "product" | "structure" | "tech" {
    const filename = basename(filePath, ".md").toLowerCase();

    if (filename.includes("product")) {
      return "product";
    }
    if (filename.includes("structure")) {
      return "structure";
    }

    // Default to tech for any other file
    return "tech";
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["kiro"],
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

    const result = KiroRuleFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return { success: false, error: result.error };
    }

    // Validate document type
    const validTypes = ["product", "structure", "tech"];
    if (!validTypes.includes(this.documentType)) {
      return {
        success: false,
        error: new Error(
          `Invalid document type: ${this.documentType}. Must be one of: ${validTypes.join(", ")}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  /**
   * Get the document type of this steering document
   */
  getDocumentType(): "product" | "structure" | "tech" {
    return this.documentType;
  }

  /**
   * Get the output file path for the generated steering document
   */
  getOutputFilePath(): string {
    return this.getRelativeFilePath();
  }

  /**
   * Get the content that should be written to the output file
   * Kiro uses plain Markdown without frontmatter
   */
  getOutputContent(): string {
    return this.body;
  }

  /**
   * Determine if this is a core steering document
   * Core documents are: product.md, structure.md, tech.md
   */
  isCoreSteeringDocument(): boolean {
    const filename = basename(this.getRelativeFilePath(), ".md").toLowerCase();
    return ["product", "structure", "tech"].includes(filename);
  }

  /**
   * Get the steering document type for debugging/logging purposes
   */
  getSteeringDocumentInfo(): string {
    const parts: string[] = [];

    parts.push(`type:${this.documentType}`);

    if (this.isCoreSteeringDocument()) {
      parts.push("core");
    } else {
      parts.push("custom");
    }

    return parts.join(" ");
  }
}
