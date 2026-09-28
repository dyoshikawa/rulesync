import { join } from "node:path";

import { z } from "zod/mini";

import { JUNIE_COMMANDS_DIR_PATH } from "../../constants/junie-paths.js";
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
const JunieCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  allowPromptArgument: z.optional(z.boolean()),
});

/**
 * Translate rulesync universal command syntax (Claude Code compatible) into
 * JetBrains Junie's native syntax. See docs/reference/command-syntax.md.
 *
 * Junie treats every `$name` in a command template as a named argument and
 * only runs the command once all of them are provided, so a literal
 * `$ARGUMENTS` would become a required argument called `ARGUMENTS`. The
 * free-form counterpart is the `$prompt` argument, exposed when the command
 * sets `allowPromptArgument: true`; the caller sets that flag whenever this
 * rewrite changed the body.
 *
 * `` !`cmd` `` is left verbatim: Junie documents no shell expansion.
 *
 * `$ARGUMENTS\b` uses a trailing word boundary so `$ARGUMENTSx` and
 * `$ARGUMENTS_FOO` (other named arguments) are left alone, while
 * `$ARGUMENTS-foo` and `$ARGUMENTS[0]` are rewritten (`-` and `[` are not
 * word characters), matching the Tabnine translation.
 * @see https://junie.jetbrains.com/docs/custom-slash-commands.html
 */
function translateRulesyncBodyToJunie(body: string): string {
  return body.replace(/\$ARGUMENTS\b/g, "$prompt");
}

/**
 * Inverse of {@link translateRulesyncBodyToJunie}, used on import. Only call it
 * when the command sets `allowPromptArgument: true`: without that flag
 * `$prompt` is an ordinary named argument called `prompt`.
 */
function translateJunieBodyToRulesync(body: string): string {
  return body.replace(/\$prompt\b/g, "$ARGUMENTS");
}

export type JunieCommandFrontmatter = z.infer<typeof JunieCommandFrontmatterSchema>;

export type JunieCommandParams = {
  frontmatter: JunieCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class JunieCommand extends ToolCommand {
  private readonly frontmatter: JunieCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: JunieCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = JunieCommandFrontmatterSchema.safeParse(frontmatter);
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
    // JetBrains Junie stores commands under `.junie/commands` for both project
    // and user scope. The relative path is identical in either mode; in global
    // mode the same path is resolved under the user home (`~/.junie/commands`).
    return {
      relativeDirPath: JUNIE_COMMANDS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...junieFields } = this.frontmatter;

    // `$prompt` is the free-form argument only when `allowPromptArgument` is
    // set. In that case rewrite it back to the universal `$ARGUMENTS` and drop
    // the flag, since generation re-derives it from the placeholder. A flag
    // set without any `$prompt` reference is kept: it still makes Junie append
    // free text as `User Input: ...`.
    const translatedBody =
      junieFields.allowPromptArgument === true
        ? translateJunieBodyToRulesync(this.body)
        : this.body;
    const { allowPromptArgument: _allowPromptArgument, ...fieldsWithoutFlag } = junieFields;
    const restFields = translatedBody !== this.body ? fieldsWithoutFlag : junieFields;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      // Preserve extra fields in junie section
      ...(Object.keys(restFields).length > 0 && { junie: restFields }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(translatedBody, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(), // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: translatedBody,
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
  }: ToolCommandFromRulesyncCommandParams): JunieCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge junie-specific fields from rulesync frontmatter
    const junieFields = rulesyncFrontmatter.junie ?? {};

    // Rewrite `$ARGUMENTS` to Junie's free-form `$prompt` argument and enable
    // it. The rewrite is skipped when the body already references `$prompt`
    // (a hand-written named argument that would otherwise merge with
    // `$ARGUMENTS` and not round-trip) or when `junie.allowPromptArgument` is
    // explicitly `false` (the `$prompt` would then be a named argument too).
    // An explicit `junie.allowPromptArgument` always wins, as the
    // tool-specific block is spread last.
    const originalBody = rulesyncCommand.getBody();
    const canTranslate =
      junieFields.allowPromptArgument !== false && !/\$prompt\b/.test(originalBody);
    const body = canTranslate ? translateRulesyncBodyToJunie(originalBody) : originalBody;
    const usesPromptArgument = body !== originalBody;

    const junieFrontmatter: JunieCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...(usesPromptArgument && { allowPromptArgument: true }),
      ...junieFields,
    };

    const paths = this.getSettablePaths({ global });

    return new JunieCommand({
      outputRoot: outputRoot,
      frontmatter: junieFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = JunieCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "junie",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<JunieCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate required fields using JunieCommandFrontmatterSchema
    const result = JunieCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new JunieCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
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
  }: ToolCommandForDeletionParams): JunieCommand {
    return new JunieCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
