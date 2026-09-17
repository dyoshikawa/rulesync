import { basename, join } from "node:path";

import { z } from "zod/mini";

import {
  KILO_COMMANDS_DIR_PATH,
  KILO_GLOBAL_COMMANDS_DIR_PATH,
} from "../../constants/kilo-paths.js";
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

export const KiloCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  agent: z.optional(z.string()),
  subtask: z.optional(z.boolean()),
  model: z.optional(z.string()),
  // Reasoning-effort override (e.g. `low` / `high`) for models that support
  // variants — the fifth field of Kilo's command schema, and the same key
  // `KiloSubagentFrontmatterSchema` models.
  // https://kilo.ai/docs/customize/workflows
  variant: z.optional(z.string()),
});

export type KiloCommandFrontmatter = z.infer<typeof KiloCommandFrontmatterSchema>;

/**
 * Command names Kilo keeps for itself. Its loader throws on a custom command
 * file named `goal.md` in either the project or the global directory ("The
 * /goal command is reserved for session goals. Rename the custom command."),
 * and a throw there aborts the whole command scan — every other custom
 * command becomes unreachable too, not only the reserved one.
 * https://github.com/Kilo-Org/kilocode/blob/v7.6.2/packages/opencode/src/command/index.ts
 */
const KILO_RESERVED_COMMAND_NAMES: ReadonlySet<string> = new Set(["goal"]);

export type KiloCommandParams = {
  frontmatter: KiloCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class KiloCommand extends ToolCommand {
  private readonly frontmatter: KiloCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: KiloCommandParams) {
    if (rest.validate) {
      const result = KiloCommandFrontmatterSchema.safeParse(frontmatter);
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
    return {
      relativeDirPath: global ? KILO_GLOBAL_COMMANDS_DIR_PATH : KILO_COMMANDS_DIR_PATH,
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
      ...(Object.keys(restFields).length > 0 && { kilo: restFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(),
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  /**
   * Refuse to write a command Kilo reserves (see
   * {@link KILO_RESERVED_COMMAND_NAMES}). The name Kilo loads is the file
   * stem, and the processor calls this on the flattened path, so `goal.md`
   * is refused at any nesting depth under the basename naming and only at the
   * top level under the path naming, where `git/goal.md` becomes `git-goal`.
   * Import is untouched: a `goal.md` already in `.kilo/commands/` is read as
   * it is, since the reservation is Kilo's to enforce on its own files.
   */
  static getWriteBlockReason({
    rulesyncCommand,
  }: {
    rulesyncCommand: RulesyncCommand;
    global: boolean;
  }): string | null {
    const stem = basename(rulesyncCommand.getRelativeFilePath(), ".md");
    if (!KILO_RESERVED_COMMAND_NAMES.has(stem)) {
      return null;
    }
    return (
      `Kilo reserves the /${stem} command for session goals and refuses to load a ` +
      `custom command by that name — it would abort Kilo's whole command scan, ` +
      `making every other custom command unreachable too. Rename the command, ` +
      `or exclude it from this target with \`targets\`.`
    );
  }

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): KiloCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const kiloFields = rulesyncFrontmatter.kilo ?? {};

    const kiloFrontmatter: KiloCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...kiloFields,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new KiloCommand({
      outputRoot: outputRoot,
      frontmatter: kiloFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    const result = KiloCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<KiloCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KiloCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiloCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "kilo",
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): KiloCommand {
    return new KiloCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
