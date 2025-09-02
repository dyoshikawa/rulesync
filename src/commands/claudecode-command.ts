import { readFile } from "node:fs/promises";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { ToolCommand, ToolCommandFromRulesyncCommandParams } from "./tool-command.js";

export const ClaudecodeCommandFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClaudecodeCommandFrontmatter = z.infer<typeof ClaudecodeCommandFrontmatterSchema>;

export type ClaudecodeCommandParams = {
  frontmatter: ClaudecodeCommandFrontmatter;
  body: string;
} & AiFileParams;

export class ClaudecodeCommand extends ToolCommand {
  private readonly frontmatter: ClaudecodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClaudecodeCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["claudecode"],
      description: this.frontmatter.description,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: false,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    relativeDirPath,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): ClaudecodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Claude Code specific frontmatter
    const body = rulesyncCommand.getBody();
    // Remove undefined values to avoid YAML dump errors
    const cleanFrontmatter = Object.fromEntries(
      Object.entries(claudecodeFrontmatter).filter(([, value]) => value !== undefined),
    );
    const fileContent = matter.stringify(body, cleanFrontmatter);

    return new ClaudecodeCommand({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ClaudecodeCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<ClaudecodeCommand> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using ClaudecodeCommandFrontmatterSchema
    const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new ClaudecodeCommand({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      validate,
    });
  }
}
