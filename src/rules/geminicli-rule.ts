import { readFile } from "node:fs/promises";
import { AiFileFromFilePathParams } from "../types/ai-file.js";
import type { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

type GeminiCliRuleParams = {
  baseDir: string;
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  body: string;
  description?: string;
  validate?: boolean;
};

/**
 * Represents a rule file for Gemini CLI
 * Gemini CLI uses plain markdown files (GEMINI.md) without frontmatter
 */
export class GeminiCliRule extends ToolRule {
  private readonly body: string;
  private readonly description: string;

  constructor(params: GeminiCliRuleParams) {
    super({
      baseDir: params.baseDir,
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent: params.fileContent,
      validate: params.validate ?? true,
    });
    this.body = params.body;
    this.description = params.description ?? "";
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<GeminiCliRule> {
    const fileContent = await readFile(params.filePath, "utf8");

    // Gemini CLI uses plain markdown without frontmatter
    // The entire file content becomes the body
    const body = fileContent.trim();

    return new GeminiCliRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): GeminiCliRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;

    return new GeminiCliRule({
      baseDir: rest.baseDir ?? ".",
      relativeDirPath: rest.relativeDirPath,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      description,
      body: rulesyncRule.getBody(),
      validate: rest.validate ?? true,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["geminicli"],
      description: this.description,
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

  validate() {
    // Gemini CLI uses plain markdown without frontmatter requirements
    // Validation always succeeds
    return { success: true as const, error: null };
  }

  /**
   * Generate GEMINI.md memory file content
   *
   * Creates a plain markdown file that serves as context for Gemini CLI,
   * following the simple format expected by Gemini CLI.
   */
  generateMemoryFile(): string {
    const sections: string[] = [];

    // Add description as project overview if available
    if (this.description) {
      sections.push(`# Project: ${this.description}`);
      sections.push("");
    }

    // Add rule content directly (Gemini CLI expects plain markdown)
    if (this.body.trim()) {
      sections.push(this.body.trim());
    }

    return sections.join("\n").trim();
  }

  /**
   * Get the output file path for the generated GEMINI.md file
   */
  getOutputFilePath(): string {
    return "GEMINI.md";
  }

  /**
   * Get the content that should be written to the output file
   */
  getOutputContent(): string {
    return this.generateMemoryFile();
  }
}
