import { join } from "node:path";

import { z } from "zod/mini";

import { FIREBENDER_COMMANDS_DIR_PATH } from "../../constants/firebender-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * Frontmatter of a Firebender command. Every field is optional: `name`
 * defaults to the file name, `model` is `default`, `quick` or a model ID, and
 * `mode` is one of `auto`, `read`, `write` or `composer`. Unknown keys are
 * preserved.
 *
 * @see https://docs.firebender.com/api-reference/commands
 */
const FirebenderCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  model: z.optional(z.string()),
  mode: z.optional(z.string()),
});

export type FirebenderCommandFrontmatter = z.infer<typeof FirebenderCommandFrontmatterSchema>;

export type FirebenderCommandParams = {
  frontmatter: FirebenderCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

const FIREBENDER_COMMAND_EXTENSION = ".mdc";

/**
 * Command generator for Firebender: one `.mdc` file per command under
 * `.firebender/commands/` (project) and `~/.firebender/commands/` (global),
 * with optional `name` / `description` / `model` / `mode` frontmatter. The
 * canonical `description` is written as is; `name`, `model` and `mode` come
 * from the `firebender:` section of the rulesync command.
 *
 * @see https://docs.firebender.com/api-reference/commands
 */
export class FirebenderCommand extends ToolCommand {
  private readonly frontmatter: FirebenderCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: FirebenderCommandParams) {
    if (rest.validate) {
      const result = FirebenderCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter, { avoidBlockScalars: true }),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return {
      relativeDirPath: FIREBENDER_COMMANDS_DIR_PATH,
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
      targets: ["*"],
      description,
      ...(Object.keys(restFields).length > 0 && { firebender: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath.replace(/\.mdc$/, ".md"),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): FirebenderCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const firebenderFields = rulesyncFrontmatter.firebender ?? {};

    const frontmatter: FirebenderCommandFrontmatter = {
      ...(rulesyncFrontmatter.description && { description: rulesyncFrontmatter.description }),
      ...firebenderFields,
    };

    return new FirebenderCommand({
      outputRoot,
      frontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncCommand
        .getRelativeFilePath()
        .replace(/\.md$/, FIREBENDER_COMMAND_EXTENSION),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: FirebenderCommandFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "firebender",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<FirebenderCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = FirebenderCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new FirebenderCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): FirebenderCommand {
    return new FirebenderCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }
}
