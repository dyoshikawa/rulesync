import { basename, join } from "node:path";

import { z } from "zod/mini";

import { CONTINUE_PROMPTS_DIR_PATH } from "../../constants/continue-paths.js";
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
 * Continue prompt files are Markdown files under `<project>/.continue/prompts/`
 * (project scope) and `~/.continue/prompts/` (user scope). A prompt with
 * `invokable: true` becomes a `/name` slash command in the chat input and the
 * CLI; without it the file is treated as a plain rule, so rulesync always sets
 * the flag. `name` is the command name (the file stem by default) and
 * `description` the hint shown next to it.
 *
 * @see https://docs.continue.dev/customize/deep-dives/prompts
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const ContinueCommandFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  invokable: z.optional(z.boolean()),
});

export type ContinueCommandFrontmatter = z.infer<typeof ContinueCommandFrontmatterSchema>;

export type ContinueCommandParams = {
  frontmatter: ContinueCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/** The command name Continue derives from a prompt file: its stem. */
function commandNameFromFilePath(relativeFilePath: string): string {
  return basename(relativeFilePath).replace(/\.md$/, "");
}

export class ContinueCommand extends ToolCommand {
  private readonly frontmatter: ContinueCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ContinueCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = ContinueCommandFrontmatterSchema.safeParse(frontmatter);
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
    // Both scopes use the same relative directory; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: CONTINUE_PROMPTS_DIR_PATH,
    };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    // `invokable` is always re-emitted on generate and `name` defaults to the
    // file stem, so neither needs to round-trip unless `name` was customized.
    const { description, name, invokable: _invokable, ...restFields } = this.frontmatter;
    const continueFields: Record<string, unknown> = {
      ...(name !== undefined &&
        name !== commandNameFromFilePath(this.relativeFilePath) && { name }),
      ...restFields,
    };

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      description,
      ...(Object.keys(continueFields).length > 0 && { continue: continueFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
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
  }: ToolCommandFromRulesyncCommandParams): ContinueCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const relativeFilePath = rulesyncCommand.getRelativeFilePath();
    const continueFields = rulesyncFrontmatter.continue ?? {};

    const continueFrontmatter: ContinueCommandFrontmatter = {
      name: commandNameFromFilePath(relativeFilePath),
      description: rulesyncFrontmatter.description,
      ...continueFields,
      // Without the flag Continue reads the file as a rule, not a command.
      invokable: true,
    };

    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new ContinueCommand({
      outputRoot,
      frontmatter: continueFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      validate,
    });
  }

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = ContinueCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "continue",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<ContinueCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = ContinueCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ContinueCommand({
      outputRoot,
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
  }: ToolCommandForDeletionParams): ContinueCommand {
    return new ContinueCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
