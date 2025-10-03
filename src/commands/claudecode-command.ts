import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
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

  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: ".claude/commands",
    };
  }

  static getSettablePathsGlobal(): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".claude", "commands"),
    };
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
      baseDir: ".", // RulesyncCommand baseDir is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): ClaudecodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    // Generate proper file content with Claude Code specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();

    return new ClaudecodeCommand({
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
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

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "claudecode",
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<ClaudecodeCommand> {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using ClaudecodeCommandFrontmatterSchema
    const result = ClaudecodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new ClaudecodeCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }
}
