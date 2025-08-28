import { readFile } from "node:fs/promises";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export interface JunieRuleParams extends AiFileParams {
  body: string;
  description?: string | undefined;
}

/**
 * Rule generator for JetBrains Junie AI coding agent
 *
 * Generates .junie/guidelines.md files based on rulesync rule content.
 * Junie uses plain markdown format without frontmatter requirements.
 */
export class JunieRule extends ToolRule {
  private readonly body: string;
  private readonly description?: string | undefined;

  constructor(params: JunieRuleParams) {
    super({
      ...params,
    });
    this.body = params.body;
    this.description = params.description ?? undefined;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<JunieRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    // For Junie, we just read the content as plain markdown without frontmatter parsing
    // If there's a description in the content, we can extract it from the first line
    const lines = fileContent.trim().split("\n");
    const firstLine = lines[0]?.trim() || "";

    // Check if the first line looks like a title (starts with #)
    let description: string | undefined;
    let body: string;

    if (firstLine.startsWith("# ")) {
      description = firstLine.substring(2).trim();
      body = lines.slice(1).join("\n").trim();
    } else {
      body = fileContent.trim();
    }

    return new JunieRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body,
      ...(description && { description }),
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): JunieRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;

    return new JunieRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body: rulesyncRule.getBody(),
      ...(description && { description }),
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["junie"],
      description: this.description || "",
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
    // Junie rules are always valid since they don't require frontmatter
    return { success: true, error: null };
  }

  /**
   * Generate .junie/guidelines.md file content
   *
   * Creates a plain markdown file that serves as project guidelines for Junie,
   * including project information, coding standards, and development guidelines.
   */
  generateGuidelinesFile(): string {
    const sections: string[] = [];

    // Add title/description if available
    if (this.description) {
      sections.push(`# ${this.description}`);
      sections.push("");
    }

    // Add rule content as guidance
    if (this.body.trim()) {
      sections.push(this.body.trim());
    }

    return sections.join("\n").trim();
  }

  /**
   * Get the output file path for the generated .junie/guidelines.md file
   */
  getOutputFilePath(): string {
    return ".junie/guidelines.md";
  }

  /**
   * Get the content that should be written to the output file
   */
  getOutputContent(): string {
    return this.generateGuidelinesFile();
  }
}
