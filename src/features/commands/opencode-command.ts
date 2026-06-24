import { join } from "node:path";

import { optional, z } from "zod/mini";

import {
  OPENCODE_COMMANDS_DIR_PATH,
  OPENCODE_GLOBAL_COMMANDS_DIR_PATH,
} from "../../constants/opencode-paths.js";
import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { asOpencodeEntries, readOpencodeConfig } from "../opencode-config.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

export const OpenCodeCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  agent: optional(z.string()),
  subtask: optional(z.boolean()),
  model: optional(z.string()),
});

export type OpenCodeCommandFrontmatter = z.infer<typeof OpenCodeCommandFrontmatterSchema>;

export type OpenCodeCommandParams = {
  frontmatter: OpenCodeCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class OpenCodeCommand extends ToolCommand {
  private readonly frontmatter: OpenCodeCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: OpenCodeCommandParams) {
    if (rest.validate) {
      const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
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
    // OpenCode's canonical directory is the plural `commands/`. The singular
    // `command/` is deprecated upstream (kept only for backwards compatibility),
    // so rulesync emits the plural form to match the documented convention and
    // its own plural `.opencode/plugins` hooks output.
    return {
      relativeDirPath: global ? OPENCODE_GLOBAL_COMMANDS_DIR_PATH : OPENCODE_COMMANDS_DIR_PATH,
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
      ...(Object.keys(restFields).length > 0 && { opencode: restFields }),
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

  static fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): OpenCodeCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const opencodeFields = rulesyncFrontmatter.opencode ?? {};

    const opencodeFrontmatter: OpenCodeCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...opencodeFields,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new OpenCodeCommand({
      outputRoot: outputRoot,
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

    const result = OpenCodeCommandFrontmatterSchema.safeParse(this.frontmatter);
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
  }: ToolCommandFromFileParams): Promise<OpenCodeCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = OpenCodeCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new OpenCodeCommand({
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
      toolTarget: "opencode",
    });
  }

  /**
   * Imports commands defined inline in `opencode.json` / `opencode.jsonc` under
   * the top-level `command` key (in addition to the Markdown files under
   * `.opencode/commands/`). Each entry's `template` becomes the command body,
   * while `description` / `agent` / `model` / `subtask` map to the frontmatter.
   *
   * Import-only: this is invoked by the commands processor when loading tool
   * files for conversion to rulesync, never for orphan deletion.
   *
   * @see https://opencode.ai/docs/commands/#json
   */
  static async loadAdditionalImportFiles({
    outputRoot = process.cwd(),
    global = false,
  }: {
    outputRoot?: string;
    global?: boolean;
  } = {}): Promise<OpenCodeCommand[]> {
    const config = await readOpencodeConfig({ outputRoot, global });
    const commandEntries = asOpencodeEntries(config.command);
    if (!commandEntries) {
      return [];
    }

    const paths = this.getSettablePaths({ global });
    const commands: OpenCodeCommand[] = [];

    for (const [name, rawEntry] of Object.entries(commandEntries)) {
      const entry = asOpencodeEntries(rawEntry);
      if (!entry) {
        continue;
      }

      const body = typeof entry.template === "string" ? entry.template : "";
      const frontmatter: OpenCodeCommandFrontmatter = {
        ...(typeof entry.description === "string" && { description: entry.description }),
        ...(typeof entry.agent === "string" && { agent: entry.agent }),
        ...(typeof entry.model === "string" && { model: entry.model }),
        ...(typeof entry.subtask === "boolean" && { subtask: entry.subtask }),
      };

      commands.push(
        new OpenCodeCommand({
          outputRoot,
          frontmatter,
          body,
          relativeDirPath: paths.relativeDirPath,
          relativeFilePath: `${name}.md`,
          validate: false,
        }),
      );
    }

    return commands;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): OpenCodeCommand {
    return new OpenCodeCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
