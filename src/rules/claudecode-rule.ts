import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export const ClaudecodeRuleFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClaudecodeRuleFrontmatter = z.infer<typeof ClaudecodeRuleFrontmatterSchema>;

export interface ClaudecodeRuleParams extends AiFileParams {
  frontmatter: ClaudecodeRuleFrontmatter;
  body: string;
}

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  private readonly body: string;
  private readonly frontmatter: ClaudecodeRuleFrontmatter;

  constructor(params: ClaudecodeRuleParams) {
    super({
      ...params,
    });
    this.body = params.body;
    this.frontmatter = params.frontmatter;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<ClaudecodeRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { data, content } = matter(fileContent);

    // Validate frontmatter, provide default if empty
    const frontmatter = ClaudecodeRuleFrontmatterSchema.parse(
      data.description ? data : { description: "" },
    );

    return new ClaudecodeRule({
      baseDir: params.baseDir || ".",
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      frontmatter,
      body: content,
      validate: params.validate ?? true,
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const { rulesyncRule, ...rest } = params;

    // Extract description from rulesync rule frontmatter
    const description = rulesyncRule.getFrontmatter().description;

    return new ClaudecodeRule({
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
      targets: ["claudecode"],
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
      ClaudecodeRuleFrontmatterSchema.parse(this.frontmatter);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error("Unknown validation error"),
      };
    }
  }

  /**
   * Generate CLAUDE.md memory file content
   *
   * Creates a markdown file that serves as persistent context for Claude Code,
   * including project information, coding standards, and import references.
   */
  generateClaudeMemoryFile(): string {
    const sections: string[] = [];

    // Add description as project overview if available
    if (this.frontmatter.description) {
      sections.push("# Project Context");
      sections.push("");
      sections.push(this.frontmatter.description);
      sections.push("");
    }

    // Add rule content as guidance
    if (this.body.trim()) {
      sections.push("# Development Guidelines");
      sections.push("");
      sections.push(this.body.trim());
      sections.push("");
    }

    // Add import reference for the source rule file
    sections.push("# Additional Context");
    sections.push("");
    sections.push(`@${this.getRelativeFilePath()}`);

    return sections.join("\n").trim();
  }

  /**
   * Get the output file path for the generated CLAUDE.md file
   */
  getOutputFilePath(): string {
    return "CLAUDE.md";
  }

  /**
   * Get the content that should be written to the output file
   */
  getOutputContent(): string {
    return this.generateClaudeMemoryFile();
  }
}
