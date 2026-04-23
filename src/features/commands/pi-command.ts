import { join } from "node:path";

import { z } from "zod/mini";

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
 * Frontmatter schema for Pi Coding Agent commands.
 *
 * Pi reads Markdown commands from `.pi/prompts/` with an optional minimal
 * frontmatter. Unknown keys are preserved via `looseObject` so the schema
 * stays tolerant to Pi's evolving command metadata.
 */
export const PiCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type PiCommandFrontmatter = z.infer<typeof PiCommandFrontmatterSchema>;

export type PiCommandParams = {
  frontmatter: PiCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Command generator for Pi Coding Agent.
 *
 * - Project scope: `.pi/prompts/<name>.md`
 * - Global scope: `~/.pi/agent/prompts/<name>.md`
 *
 * Pi's argument placeholders (`$1`, `$2`, `$@`, `$ARGUMENTS`) are compatible
 * with rulesync command bodies, so the body is passed through verbatim.
 */
export class PiCommand extends ToolCommand {
  private readonly frontmatter: PiCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: PiCommandParams) {
    if (rest.validate) {
      const result = PiCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
      fileContent: PiCommand.generateFileContent(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  private static generateFileContent(body: string, frontmatter: PiCommandFrontmatter): string {
    // Emit frontmatter only when there is at least one defined field.
    const hasContent = Object.values(frontmatter).some((value) => value !== undefined);
    if (!hasContent) {
      return body;
    }
    return stringifyFrontmatter(body, frontmatter);
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".pi", "agent", "prompts"),
      };
    }
    return {
      relativeDirPath: join(".pi", "prompts"),
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
      // Preserve Pi-specific fields (e.g. `argument-hint`) under a `pi:`
      // section so round-trips retain tool-specific metadata.
      ...(Object.keys(restFields).length > 0 && { pi: restFields }),
    };

    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): PiCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();
    const piFields = rulesyncFrontmatter.pi ?? {};

    const piFrontmatter: PiCommandFrontmatter = {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...piFields,
    };

    const paths = this.getSettablePaths({ global });

    return new PiCommand({
      baseDir,
      frontmatter: piFrontmatter,
      body: rulesyncCommand.getBody(),
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }
    const result = PiCommandFrontmatterSchema.safeParse(this.frontmatter);
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
      toolTarget: "pi",
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<PiCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = PiCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new PiCommand({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): PiCommand {
    return new PiCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }
}
