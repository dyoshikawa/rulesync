import { join } from "node:path";

import { z } from "zod/mini";

import {
  LETTACODE_GLOBAL_COMMANDS_DIR_PATH,
  LETTACODE_PROJECT_COMMANDS_DIR_PATH,
} from "../../constants/lettacode-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { quoteForLog, stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

/**
 * The only frontmatter keys Letta Code reads from a custom command
 * (`parseCommandFile` in `src/cli/commands/custom.ts`). Anything else — e.g.
 * `allowed-tools`, `model` or `disable-model-invocation` copied over from a
 * Claude Code command — is parsed and ignored upstream.
 */
const LETTACODE_COMMAND_FRONTMATTER_KEYS = ["description", "argument-hint"] as const;

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3),
// so an imported command keeps fields Letta Code ignores.
export const LettacodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type LettacodeCommandFrontmatter = z.infer<typeof LettacodeCommandFrontmatterSchema>;

export type LettacodeCommandParams = {
  frontmatter: LettacodeCommandFrontmatter;
  body: string;
  /** False for a project-scope deletion candidate; see {@link LettacodeCommand.forDeletion}. */
  deletable?: boolean;
} & Omit<AiFileParams, "fileContent">;

function pickLettacodeFrontmatter({
  section,
  relativeFilePath,
  logger,
}: {
  section: unknown;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  if (!isRecord(section)) {
    return {};
  }
  const picked: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(section)) {
    if ((LETTACODE_COMMAND_FRONTMATTER_KEYS as readonly string[]).includes(key)) {
      picked[key] = value;
      continue;
    }
    warnWithFallback(
      logger,
      `Letta Code commands: dropping lettacode.${stripControlCharacters(key)} from ${quoteForLog(relativeFilePath)}: Letta Code only reads ${LETTACODE_COMMAND_FRONTMATTER_KEYS.join(" and ")}.`,
    );
  }
  return picked;
}

/**
 * Letta Code custom slash commands: Markdown prompt files under `.commands/`
 * (project, at the working-directory root) and `~/.letta/commands/` (global),
 * discovered recursively. The file basename is the command id and a
 * subdirectory is a namespace; a project command wins over a global one with
 * the same id. Frontmatter supports `description` (defaulting to the first body
 * line) and `argument-hint`; the body supports `$ARGUMENTS`, `$1`..`$9`,
 * `` !`command` `` and `@file`.
 *
 * `description` comes from the rulesync frontmatter; a `lettacode:` section
 * may set `argument-hint` (and override `description`). Other keys in that
 * section are dropped with a warning because Letta Code never reads them.
 *
 * @see https://docs.letta.com/platform/cli/slash-commands
 * @see https://github.com/letta-ai/letta-code/blob/main/src/cli/commands/custom.ts
 */
export class LettacodeCommand extends ToolCommand {
  private readonly frontmatter: LettacodeCommandFrontmatter;
  private readonly body: string;
  private readonly deletable: boolean;

  constructor({ frontmatter, body, deletable = true, ...rest }: LettacodeCommandParams) {
    if (rest.validate) {
      const result = LettacodeCommandFrontmatterSchema.safeParse(frontmatter);
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
    this.deletable = deletable;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: global
        ? LETTACODE_GLOBAL_COMMANDS_DIR_PATH
        : LETTACODE_PROJECT_COMMANDS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  override isDeletable(): boolean {
    return this.deletable;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      ...(Object.keys(restFields).length > 0 && { lettacode: restFields }),
    };

    return new RulesyncCommand({
      outputRoot: ".",
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
    logger,
  }: ToolCommandFromRulesyncCommandParams): LettacodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const lettacodeFields = pickLettacodeFrontmatter({
      section: rulesyncFrontmatter.lettacode,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      logger,
    });

    const frontmatter: LettacodeCommandFrontmatter = {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...lettacodeFields,
    };

    const paths = this.getSettablePaths({ global });

    return new LettacodeCommand({
      outputRoot,
      frontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = LettacodeCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "lettacode",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<LettacodeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body } = parseFrontmatter(fileContent, filePath);

    const result = LettacodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new LettacodeCommand({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: body.trim(),
      validate,
      global,
    });
  }

  /**
   * The project root `.commands/` is a generic directory name at the top of
   * the repository, so it may well hold prompts rulesync never wrote (Letta
   * Code reads every `*.md` there). `--delete` therefore leaves project-scope
   * files alone: generation still overwrites the commands rulesync emits, but
   * a stale one is removed by hand. The global `~/.letta/commands/` directory
   * belongs to Letta Code and is swept as usual.
   */
  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolCommandForDeletionParams): LettacodeCommand {
    return new LettacodeCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
      global,
      deletable: global,
    });
  }
}
