import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandFromFileParams,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

export const OpencodeCommandFrontmatterSchema = z.looseObject({
  description: z.string(),
});

export type OpencodeCommandFrontmatter = z.infer<typeof OpencodeCommandFrontmatterSchema>;

export type OpencodeCommandParams = {
  frontmatter: OpencodeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class OpencodeCommand extends ToolCommand {
  private readonly frontmatter: OpencodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpencodeCommandParams) {
    if (rest.validate) {
      const result = OpencodeCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".config", "opencode", "command"),
      };
    }

    return {
      relativeDirPath: join(".opencode", "command"),
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["opencode"],
      description,
      ...(Object.keys(restFields).length > 0 && { opencode: restFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): OpencodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const opencodeFields = rulesyncFrontmatter.opencode ?? {};

    const opencodeFrontmatter: OpencodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...opencodeFields,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new OpencodeCommand({
      baseDir,
      frontmatter: opencodeFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = OpencodeCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }

    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "opencode",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<OpencodeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = OpencodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OpencodeCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }
}
