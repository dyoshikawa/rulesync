import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const QwencodeRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type QwencodeRuleFrontmatter = z.infer<typeof QwencodeRuleFrontmatterSchema>;

export interface QwencodeRuleParams extends AiFileParams {
  frontmatter: QwencodeRuleFrontmatter;
  body: string;
}

/**
 * Rule generator for Qwen Code AI assistant
 *
 * Generates QWEN.md memory files based on rulesync rule content.
 * Supports the Qwen Code context management system with hierarchical discovery.
 */
export class QwencodeRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: QwencodeRuleFrontmatter;

  constructor(params: QwencodeRuleParams) {
    super({
      ...params,
    });
    this.body = params.body;
    this.frontmatter = params.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<QwencodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { data, content } = matter(fileContent);

    // Validate frontmatter, provide default if empty
    const frontmatter = QwencodeRuleFrontmatterSchema.parse(
      data.description ? data : { description: "" },
    );

    return new QwencodeRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body: content,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): QwencodeRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;

    return new QwencodeRule({
      ...rest,
      fileContent: rulesyncRule.getFileContent(),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      frontmatter: { description },
      body: rulesyncRule.getBody(),
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: false,
      targets: ["qwencode"],
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
    try {
      QwencodeRuleFrontmatterSchema.parse(this.frontmatter);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error("Unknown validation error"),
      };
    }
  }

  /**
   * Generate QWEN.md memory file content
   *
   * Creates a markdown file that serves as persistent context for Qwen Code,
   * including project information, technology stack, and Qwen3-Coder specific guidance.
   */
  generateQwenMemoryFile(): string {
    const sections: string[] = [];

    // Add description as project overview if available
    if (this.frontmatter.description) {
      sections.push("# Project Context");
      sections.push("");
      sections.push(this.frontmatter.description);
      sections.push("");
    }

    // Add rule content as development guidelines
    if (this.body.trim()) {
      sections.push("# Development Guidelines");
      sections.push("");
      sections.push(this.body.trim());
      sections.push("");
    }

    // Add Qwen3-Coder specific optimization instructions
    sections.push("# AI Assistant Instructions");
    sections.push("");
    sections.push("## Qwen3-Coder Optimization");
    sections.push("- Leverage advanced code understanding capabilities");
    sections.push("- Use multi-language programming support");
    sections.push("- Apply agentic coding patterns");
    sections.push("- Implement function calling where appropriate");
    sections.push("- Use code interpretation features for complex analysis");
    sections.push("- Focus on providing detailed code explanations");
    sections.push("- Include comprehensive error handling in all functions");
    sections.push("- Use descriptive variable names and clear documentation");
    sections.push("");

    // Add reference to the source rule file
    sections.push("# Additional Context");
    sections.push("");
    sections.push(`Source rule file: ${this.getRelativeFilePath()}`);

    return sections.join("\n").trim();
  }

  /**
   * Get the output file path for the generated QWEN.md file
   */
  getOutputFilePath(): string {
    return "QWEN.md";
  }

  /**
   * Get the content that should be written to the output file
   */
  getOutputContent(): string {
    return this.generateQwenMemoryFile();
  }
}
