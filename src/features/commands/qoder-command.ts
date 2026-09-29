import { join } from "node:path";

import { z } from "zod/mini";

import { QODER_COMMANDS_DIR_PATH } from "../../constants/qoder-paths.js";
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
export const QoderCommandFrontmatterSchema = z.looseObject({
  // Required by Qoder: shown in the TUI command list.
  description: z.optional(z.string()),
  // Display name in the TUI only; the invocation name always comes from the
  // file path, so rulesync never derives it.
  name: z.optional(z.string()),
});

export type QoderCommandFrontmatter = z.infer<typeof QoderCommandFrontmatterSchema>;

export type QoderCommandParams = {
  frontmatter: QoderCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Custom slash command for Qoder.
 *
 * Qoder reads Markdown prompt commands with YAML frontmatter from
 * `.qoder/commands/` (project) and `~/.qoder/commands/` (user). The command's
 * invocation name is derived from its path — subdirectories namespace with
 * `:`, so `git/commit.md` registers as `/git:commit` — and the frontmatter
 * `name` is only the TUI display label. rulesync writes the rulesync
 * `description` plus any fields of the `qoder` section (which win over the
 * shared ones), and keeps nested command paths.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/command
 */
export class QoderCommand extends ToolCommand {
  private readonly frontmatter: QoderCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: QoderCommandParams) {
    if (rest.validate) {
      const result = QoderCommandFrontmatterSchema.safeParse(frontmatter);
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

  // Both scopes share the same relative path; the home-directory root is
  // applied by the generate pipeline in global mode.
  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: QODER_COMMANDS_DIR_PATH,
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
      ...(Object.keys(restFields).length > 0 && { qoder: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent: stringifyFrontmatter(this.body, rulesyncFrontmatter),
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): QoderCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const qoderFrontmatter: QoderCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...rulesyncFrontmatter.qoder,
    };

    return new QoderCommand({
      outputRoot,
      frontmatter: qoderFrontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = QoderCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "qoder",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<QoderCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = QoderCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new QoderCommand({
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
  }: ToolCommandForDeletionParams): QoderCommand {
    return new QoderCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
