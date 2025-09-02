import { basename, join } from "node:path";
import matter from "gray-matter";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFilePathParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

export const ClaudecodeCommandFrontmatterSchema = z.object({
  description: z.string(),
});

export type ClaudecodeCommandFrontmatter = z.infer<typeof ClaudecodeCommandFrontmatterSchema>;

export type ClaudecodeCommandParams = {
  frontmatter: ClaudecodeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class ClaudecodeCommand extends ToolCommand {
  private readonly frontmatter: ClaudecodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ClaudecodeCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
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
      targets: ["*"],
      description: this.frontmatter.description,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): ClaudecodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Claude Code specific frontmatter
    const body = rulesyncCommand.getBody();

    return new ClaudecodeCommand({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: join(".claude", "commands"),
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
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
    filePath,
    validate = true,
  }: ToolCommandFromFilePathParams): Promise<ClaudecodeCommand> {
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { data: frontmatter, content } = matter(fileContent);

    // Validate frontmatter using ClaudecodeCommandFrontmatterSchema
    const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new ClaudecodeCommand({
      baseDir: baseDir,
      relativeDirPath: ".claude/commands",
      relativeFilePath: basename(filePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }
}
