import { basename, join } from "node:path";

import { z } from "zod/mini";

import { TRAE_COMMANDS_DIR_PATH } from "../../constants/trae-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { quoteForLog } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, toPosixPath } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
const TraeCommandFrontmatterSchema = z.looseObject({
  // The command's purpose, shown next to it in the `/` menu.
  description: z.optional(z.string()),
  // The command's identifier. Trae's editor fills it with the file name stem
  // when it creates a command, so rulesync writes the stem unless the `trae`
  // section sets its own `name`.
  name: z.optional(z.string()),
});

/**
 * Trae reads project commands only up to three directory levels below
 * `.trae/commands/`; a command file nested deeper is never picked up.
 */
const TRAE_MAX_PROJECT_COMMAND_DIR_DEPTH = 3;

export type TraeCommandFrontmatter = z.infer<typeof TraeCommandFrontmatterSchema>;

export type TraeCommandParams = {
  frontmatter: TraeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Custom command for Trae.
 *
 * Trae reads Markdown command files under `.trae/commands/` (project, up to
 * three levels of nested directories) and `~/.trae/commands/` (global). The
 * YAML frontmatter carries `name` and `description`, and the body below the
 * closing `---` holds the instructions. rulesync writes the rulesync
 * `description`, a `name` equal to the file name stem (as Trae's editor does),
 * plus any fields of the `trae` section (which win over the derived ones), and
 * keeps nested command paths.
 *
 * @see https://docs.trae.ai/ide/slash-commands?_lang=en
 */
export class TraeCommand extends ToolCommand {
  private readonly frontmatter: TraeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: TraeCommandParams) {
    if (rest.validate) {
      const result = TraeCommandFrontmatterSchema.safeParse(frontmatter);
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
      relativeDirPath: TRAE_COMMANDS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, name, ...otherFields } = this.frontmatter;
    // A `name` equal to the file name stem is what the next generate derives
    // anyway, so only a custom one is kept in the `trae` section.
    const restFields =
      name === undefined || name === basename(this.relativeFilePath, ".md")
        ? otherFields
        : { name, ...otherFields };

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      ...(Object.keys(restFields).length > 0 && { trae: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): TraeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const { name: _name, ...traeFields } = rulesyncFrontmatter.trae ?? {};
    // Typed loosely so an invalid `trae.name` reaches validation unchanged.
    const traeFrontmatter = {
      name: this.deriveName(rulesyncCommand),
      description: rulesyncFrontmatter.description,
      ...traeFields,
    } as TraeCommandFrontmatter;

    return new TraeCommand({
      outputRoot,
      frontmatter: traeFrontmatter,
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

    return validateFrontmatterSchema({
      schema: TraeCommandFrontmatterSchema,
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  /**
   * Warn about commands Trae will not load as written: Trae documents `name`
   * as the command's unique identifier, so two commands deriving the same
   * `name` (e.g. `a/review.md` and `b/review.md`) collide, and it reads
   * project commands only up to three nested directory levels. Both files are
   * still written, so this warns rather than failing the run.
   */
  static validateRulesyncCommands({
    rulesyncCommands,
    logger,
    global = false,
  }: {
    rulesyncCommands: RulesyncCommand[];
    logger: Logger;
    global?: boolean;
  }): void {
    const pathsByName = new Map<string, string[]>();
    for (const rulesyncCommand of rulesyncCommands) {
      if (!this.isTargetedByRulesyncCommand(rulesyncCommand)) continue;
      const relativeFilePath = toPosixPath(rulesyncCommand.getRelativeFilePath());
      const name = this.deriveName(rulesyncCommand);
      if (typeof name === "string") {
        pathsByName.set(name, [...(pathsByName.get(name) ?? []), relativeFilePath]);
      }

      const dirDepth = relativeFilePath.split("/").length - 1;
      if (!global && dirDepth > TRAE_MAX_PROJECT_COMMAND_DIR_DEPTH) {
        logger.warn(
          `Trae reads project commands only up to ${TRAE_MAX_PROJECT_COMMAND_DIR_DEPTH} nested directory levels, ` +
            `so ${quoteForLog(relativeFilePath)} is written but never loaded. Move it to a shallower directory.`,
        );
      }
    }
    for (const [name, paths] of pathsByName) {
      if (paths.length < 2) continue;
      logger.warn(
        `Trae command name ${quoteForLog(name)} is shared by ${paths.map(quoteForLog).join(", ")}, ` +
          `but Trae treats \`name\` as a unique identifier. Rename a file or set \`trae.name\` to tell them apart.`,
      );
    }
  }

  /**
   * The `name` Trae sees for a command: the `trae` section's `name` when set,
   * otherwise the file name stem. A non-string override is returned as is so
   * frontmatter validation still rejects it.
   */
  private static deriveName(rulesyncCommand: RulesyncCommand): unknown {
    return (
      rulesyncCommand.getFrontmatter().trae?.name ??
      basename(rulesyncCommand.getRelativeFilePath(), ".md")
    );
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "trae",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<TraeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = TraeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new TraeCommand({
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
  }: ToolCommandForDeletionParams): TraeCommand {
    return new TraeCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
