import { join } from "node:path";

import { z } from "zod/mini";

import { REASONIX_COMMANDS_DIR_PATH } from "../../constants/reasonix-paths.js";
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
 * Reasonix custom slash commands are Markdown files under `.reasonix/commands/`
 * (project) / `~/.reasonix/commands/` (global) — directly analogous to Claude
 * Code's `.claude/commands/` (Reasonix explicitly copies Claude Code's
 * conventions). Frontmatter supports `description` and `argument-hint`; the
 * body uses the same `$ARGUMENTS` / `$1`…`$N` placeholder syntax rulesync's
 * universal command-body syntax already targets.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const ReasonixCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type ReasonixCommandFrontmatter = z.infer<typeof ReasonixCommandFrontmatterSchema>;

export type ReasonixCommandParams = {
  frontmatter: ReasonixCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class ReasonixCommand extends ToolCommand {
  private readonly frontmatter: ReasonixCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: ReasonixCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = ReasonixCommandFrontmatterSchema.safeParse(frontmatter);
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
    // Both project and global scope use the same relative dir; the processor
    // supplies the home directory as outputRoot in global mode.
    return {
      relativeDirPath: REASONIX_COMMANDS_DIR_PATH,
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
      // Preserve extra fields in the reasonix section
      ...(Object.keys(restFields).length > 0 && { reasonix: restFields }),
    };

    // Generate proper file content with Rulesync specific frontmatter
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
  }: ToolCommandFromRulesyncCommandParams): ReasonixCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge reasonix-specific fields from rulesync frontmatter
    const reasonixFields = rulesyncFrontmatter.reasonix ?? {};

    const reasonixFrontmatter: ReasonixCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      ...reasonixFields,
    };

    // Generate proper file content with Reasonix specific frontmatter
    const body = rulesyncCommand.getBody();

    const paths = this.getSettablePaths({ global });

    return new ReasonixCommand({
      outputRoot: outputRoot,
      frontmatter: reasonixFrontmatter,
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

    const result = ReasonixCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "reasonix",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<ReasonixCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    // Validate required fields using ReasonixCommandFrontmatterSchema
    const result = ReasonixCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new ReasonixCommand({
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
  }: ToolCommandForDeletionParams): ReasonixCommand {
    return new ReasonixCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "" },
      body: "",
      validate: false,
    });
  }
}
