import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import { ToolRule, ToolRuleFromRulesyncRuleParams } from "./tool-rule.js";

export type CodexcliRuleParams = Omit<AiFileParams, "fileContent"> & {
  body: string;
  fileContent?: string;
};

/**
 * Rule generator for OpenAI Codex CLI
 *
 * Generates AGENTS.md files based on rulesync rule content.
 * Supports the OpenAI Codex CLI memory/instructions system with
 * hierarchical loading (global, project, directory-specific).
 */
export class CodexcliRule extends ToolRule {
  private readonly body: string;

  constructor({ body, fileContent, ...rest }: CodexcliRuleParams) {
    const actualFileContent = fileContent || body;

    super({
      ...rest,
      fileContent: actualFileContent,
    });

    this.body = body;
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<CodexcliRule> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { content } = matter(fileContent);

    // If there's no frontmatter, gray-matter returns the entire content as content
    // If the original file had no frontmatter, use the original fileContent
    const body = content.trim() || fileContent.trim();

    return new CodexcliRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      body,
      fileContent,
      validate,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    relativeDirPath,
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CodexcliRule {
    const body = rulesyncRule.getBody();
    const fileContent = body; // OpenAI Codex CLI rules are plain markdown without frontmatter

    return new CodexcliRule({
      baseDir,
      relativeDirPath,
      relativeFilePath: rulesyncRule.getRelativeFilePath(),
      body,
      fileContent,
      validate,
    });
  }

  toRulesyncRule(): RulesyncRule {
    const frontmatter = {
      root: false, // OpenAI Codex CLI supports subdirectories
      targets: ["codexcli" as const],
      description: "OpenAI Codex CLI instructions",
      globs: ["**/*"],
    };

    // OpenAI Codex CLI rules use plain markdown content
    const fileContent = matter.stringify(this.body, frontmatter);

    return new RulesyncRule({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      frontmatter,
      body: this.body,
      fileContent,
      validate: false,
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
