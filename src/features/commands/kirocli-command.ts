import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const KiroCliCommandFrontmatterSchema = z.looseObject({
  description: z.string(),
});

export type KiroCliCommandFrontmatter = z.infer<typeof KiroCliCommandFrontmatterSchema>;

export type KiroCliCommandParams = {
  frontmatter: KiroCliCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Command generator for Kiro CLI
 *
 * Generates prompt files for Kiro CLI's prompt management system.
 * Outputs to .kiro/prompts/ directory as markdown files.
 */
export class KiroCliCommand extends ToolCommand {
  private readonly frontmatter: KiroCliCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: KiroCliCommandParams) {
    if (rest.validate) {
      const result = KiroCliCommandFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".kiro", "prompts"),
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
      targets: ["kirocli"],
      description,
      ...(Object.keys(restFields).length > 0 && { kirocli: restFields }),
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
  }: ToolCommandFromRulesyncCommandParams): KiroCliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const kirocliFields = rulesyncFrontmatter.kirocli ?? {};

    const kirocliCommandFrontmatter: KiroCliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...kirocliFields,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new KiroCliCommand({
      baseDir: baseDir,
      frontmatter: kirocliCommandFrontmatter,
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

    const result = KiroCliCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kirocli",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<KiroCliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = KiroCliCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiroCliCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): KiroCliCommand {
    return new KiroCliCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
