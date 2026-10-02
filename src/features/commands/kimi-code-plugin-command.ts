import { join } from "node:path";

import { z } from "zod/mini";

import { KIMI_CODE_PLUGIN_COMMANDS_DIR } from "../../constants/plugin-paths.js";
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

/**
 * Kimi Code reads only `name` and `description` from a plugin command. The
 * name defaults to the file's path under `commands/` (without `.md`), so it is
 * written only when the `kimi-code-plugin` section of a Rulesync command sets
 * one.
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const KimiCodePluginCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
});

export type KimiCodePluginCommandFrontmatter = z.infer<
  typeof KimiCodePluginCommandFrontmatterSchema
>;

type KimiCodePluginCommandParams = {
  frontmatter: KimiCodePluginCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Slash command inside a Kimi Code plugin bundle (`<plugin>/commands/**\/*.md`),
 * registered as `/<plugin>:<name>` when the manifest declares
 * `"commands": "./commands/"`. `$ARGUMENTS` in the body is replaced with the
 * typed arguments, which are otherwise appended as `ARGUMENTS: <text>`.
 *
 * Plugins are Kimi Code's only file-based command surface; the plain
 * `kimi-code` target has none.
 *
 * @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
 */
export class KimiCodePluginCommand extends ToolCommand {
  private readonly frontmatter: KimiCodePluginCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: KimiCodePluginCommandParams) {
    if (rest.validate) {
      const result = KimiCodePluginCommandFrontmatterSchema.safeParse(frontmatter);
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

  static getSettablePaths(): ToolCommandSettablePaths {
    return { relativeDirPath: KIMI_CODE_PLUGIN_COMMANDS_DIR };
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
      ...(Object.keys(restFields).length > 0 && { "kimi-code-plugin": restFields }),
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
  }: ToolCommandFromRulesyncCommandParams): KimiCodePluginCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const toolFields = rulesyncFrontmatter["kimi-code-plugin"] ?? {};

    const frontmatter: KimiCodePluginCommandFrontmatter = {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...toolFields,
    };

    return new KimiCodePluginCommand({
      outputRoot,
      frontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = KimiCodePluginCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "kimi-code-plugin",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<KimiCodePluginCommand> {
    const relativeDirPath = this.getSettablePaths().relativeDirPath;
    const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KimiCodePluginCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KimiCodePluginCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): KimiCodePluginCommand {
    return new KimiCodePluginCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }
}
