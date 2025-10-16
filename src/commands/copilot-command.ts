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

export const CopilotCommandFrontmatterSchema = z.object({
  mode: z.literal("agent"),
  description: z.string(),
});

export type CopilotCommandFrontmatter = z.infer<typeof CopilotCommandFrontmatterSchema>;

export type CopilotCommandParams = {
  frontmatter: CopilotCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class CopilotCommand extends ToolCommand {
  private readonly frontmatter: CopilotCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CopilotCommandParams) {
    if (rest.validate) {
      const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${result.error.message}`,
        );
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
      relativeDirPath: join(".github", "prompts"),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): CopilotCommandFrontmatter {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description: this.frontmatter.description,
    };

    // Strip .prompt.md extension and normalize to .md
    const originalFilePath = this.relativeFilePath;
    const relativeFilePath = originalFilePath.replace(/\.prompt\.md$/, ".md");

    return new RulesyncCommand({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
      fileContent: this.getFileContent(),
      validate: true,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = CopilotCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${result.error.message}`,
        ),
      };
    }
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): CopilotCommand {
    const paths = this.getSettablePaths();
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const copilotFrontmatter: CopilotCommandFrontmatter = {
      mode: "agent",
      description: rulesyncFrontmatter.description,
    };

    const body = rulesyncCommand.getBody();

    // Change file extension from .md to .prompt.md
    const originalFilePath = rulesyncCommand.getRelativeFilePath();
    const relativeFilePath = originalFilePath.replace(/\.md$/, ".prompt.md");

    return new CopilotCommand({
      baseDir: baseDir,
      frontmatter: copilotFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<CopilotCommand> {
    const paths = this.getSettablePaths();
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = CopilotCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return new CopilotCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "copilot",
    });
  }
}
