import { readFile } from "node:fs/promises";
import { join } from "node:path";
import matter from "gray-matter";
import { RULESYNC_RULES_DIR } from "../constants/paths.js";
import { AiFileFromFilePathParams, ValidationResult } from "../types/ai-file.js";
import { RuleFrontmatter } from "../types/rules.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams, ToolRuleParams } from "./tool-rule.js";

export interface CodexcliRuleParams extends Omit<ToolRuleParams, "fileContent"> {
  body: string;
  fileContent?: string;
}

/**
 * Rule generator for OpenAI Codex CLI
 *
 * Generates AGENTS.md files based on rulesync rule content.
 * Supports the OpenAI Codex CLI memory/instructions system with
 * hierarchical loading (global, project, directory-specific).
 */
export class CodexcliRule extends ToolRule {
  private readonly body: string;

  constructor(params: CodexcliRuleParams) {
    super({
      ...params,
      fileContent: params.fileContent || params.body,
    });

    this.body = params.body;
  }

  static async fromFilePath(params: AiFileFromFilePathParams): Promise<CodexcliRule> {
    const fileContent = await readFile(params.filePath, "utf8");
    const { content } = matter(fileContent);

    // If there's no frontmatter, gray-matter returns the entire content as content
    // If the original file had no frontmatter, use the original fileContent
    const body = content.trim() || fileContent.trim();

    return new CodexcliRule({
      baseDir: params.baseDir || process.cwd(),
      relativeDirPath: params.relativeDirPath,
      relativeFilePath: params.relativeFilePath,
      fileContent,
      body,
      validate: params.validate ?? true,
      root: params.relativeFilePath === "AGENTS.md",
    });
  }

  static fromRulesyncRule(params: ToolRuleFromRulesyncRuleParams): CodexcliRule {
    const { rulesyncRule, ...rest } = params;

    const root = rulesyncRule.getFrontmatter().root;
    const body = rulesyncRule.getBody();

    if (root) {
      return new CodexcliRule({
        ...rest,
        fileContent: body,
        relativeFilePath: "AGENTS.md",
        body,
        root,
      });
    }

    return new CodexcliRule({
      ...rest,
      fileContent: body,
      relativeDirPath: join(".codex", "memories"),
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      root,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const rulesyncFrontmatter: RuleFrontmatter = {
      root: this.isRoot(),
      targets: ["codexcli"],
      description: "",
      globs: ["**/*"],
    };

    return new RulesyncRule({
      baseDir: this.getBaseDir(),
      relativeDirPath: RULESYNC_RULES_DIR,
      relativeFilePath: this.getRelativeFilePath(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      fileContent: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    // OpenAI Codex CLI rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  getBody(): string {
    return this.body;
  }

  /**
   * Generate AGENTS.md file content for OpenAI Codex CLI
   *
   * Creates a markdown file that serves as persistent context for Codex CLI,
   * following the hierarchical instruction system (global, project, directory-specific).
   */
  generateAgentsFile(): string {
    const sections: string[] = [];

    // Add project header
    sections.push("# Project Instructions");
    sections.push("");

    // Add rule content as guidance
    if (this.body.trim()) {
      sections.push(this.body.trim());
      sections.push("");
    } else {
      // Provide default content if body is empty
      sections.push("## Development Guidelines");
      sections.push("");
      sections.push("This file contains project-specific instructions for OpenAI Codex CLI.");
      sections.push("");
      sections.push("Add your coding standards, project conventions, and guidelines here.");
    }

    return sections.join("\n").trim();
  }

  /**
   * Get the output file path for the generated AGENTS.md file
   */
  getOutputFilePath(): string {
    return "AGENTS.md";
  }

  /**
   * Get the content that should be written to the output file
   */
  getOutputContent(): string {
    return this.generateAgentsFile();
  }
}
