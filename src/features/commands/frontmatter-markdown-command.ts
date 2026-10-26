import { join } from "node:path";

import type { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { RulesyncCommand, type RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  type ToolCommandForDeletionParams,
  type ToolCommandFromFileParams,
  type ToolCommandFromRulesyncCommandParams,
  type ToolCommandSettablePaths,
} from "./tool-command.js";

/** The frontmatter shape every tool schema of this kind accepts. */
export type FrontmatterMarkdownToolCommandFrontmatter = {
  description?: string;
} & Record<string, unknown>;

export type FrontmatterMarkdownToolCommandParams<
  TFrontmatter extends FrontmatterMarkdownToolCommandFrontmatter =
    FrontmatterMarkdownToolCommandFrontmatter,
> = {
  frontmatter: TFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

/**
 * Base class for targets whose command is one Markdown file per command with a
 * YAML frontmatter block, validated by a tool-specific schema, and whose extra
 * frontmatter keys round-trip through the `<toolTarget>:` section of the
 * Rulesync command.
 *
 * Subclasses provide `getSettablePaths`, `getToolTarget` and
 * `getFrontmatterSchema`, and may override the frontmatter mapping hooks
 * (`toToolFrontmatter`, `toRulesyncFrontmatter`), `stringifyFileContent` and
 * `getDeletionFrontmatter` where the tool differs from the default.
 */
export class FrontmatterMarkdownToolCommand<
  TFrontmatter extends FrontmatterMarkdownToolCommandFrontmatter =
    FrontmatterMarkdownToolCommandFrontmatter,
> extends ToolCommand {
  protected readonly frontmatter: TFrontmatter;
  protected readonly body: string;

  constructor({ frontmatter, body, ...rest }: FrontmatterMarkdownToolCommandParams<TFrontmatter>) {
    const toolCommandClass = new.target;
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = validateFrontmatterSchema({
        schema: toolCommandClass.getFrontmatterSchema(),
        frontmatter,
        relativeDirPath: rest.relativeDirPath,
        relativeFilePath: rest.relativeFilePath,
      });
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      fileContent: toolCommandClass.stringifyFileContent({ body, frontmatter }),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  /** The tool target, also the key of the tool's section in the Rulesync frontmatter. */
  protected static getToolTarget(): ToolTarget {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static getFrontmatterSchema(): z.ZodMiniType<FrontmatterMarkdownToolCommandFrontmatter> {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static stringifyFileContent({
    body,
    frontmatter,
  }: {
    body: string;
    frontmatter: Record<string, unknown>;
  }): string {
    return stringifyFrontmatter(body, frontmatter);
  }

  /** The tool frontmatter emitted for a Rulesync command. */
  protected static toToolFrontmatter(
    rulesyncFrontmatter: RulesyncCommandFrontmatter,
  ): FrontmatterMarkdownToolCommandFrontmatter {
    const toolFields = rulesyncFrontmatter[this.getToolTarget()] ?? {};
    return {
      description: rulesyncFrontmatter.description,
      ...toolFields,
    };
  }

  /** The frontmatter of the minimal instance built for deletion. */
  protected static getDeletionFrontmatter(): FrontmatterMarkdownToolCommandFrontmatter {
    return { description: "" };
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): TFrontmatter {
    return this.frontmatter;
  }

  /** The Rulesync frontmatter this tool command imports as. */
  protected toRulesyncFrontmatter(): RulesyncCommandFrontmatter {
    const toolTarget = (this.constructor as typeof FrontmatterMarkdownToolCommand).getToolTarget();
    const { description, ...restFields } = this.frontmatter;

    return {
      targets: ["*"],
      description,
      // Preserve extra fields in the tool's section
      ...(Object.keys(restFields).length > 0 && { [toolTarget]: restFields }),
    };
  }

  toRulesyncCommand(): RulesyncCommand {
    return new RulesyncCommand({
      outputRoot: ".", // RulesyncCommand outputRoot is always the project root directory
      frontmatter: this.toRulesyncFrontmatter(),
      body: this.body,
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: this.relativeFilePath,
      validate: true,
    });
  }

  static override fromRulesyncCommand({
    outputRoot = process.cwd(),
    rulesyncCommand,
    validate = true,
    global = false,
  }: ToolCommandFromRulesyncCommandParams): FrontmatterMarkdownToolCommand {
    const frontmatter = this.toToolFrontmatter(rulesyncCommand.getFrontmatter());
    const body = rulesyncCommand.getBody();
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter,
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

    return validateFrontmatterSchema({
      schema: (this.constructor as typeof FrontmatterMarkdownToolCommand).getFrontmatterSchema(),
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static override isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: this.getToolTarget(),
    });
  }

  static override async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<FrontmatterMarkdownToolCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = this.getFrontmatterSchema().safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      frontmatter: result.data,
      body: content.trim(),
      validate,
    });
  }

  static override forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): FrontmatterMarkdownToolCommand {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: this.getDeletionFrontmatter(),
      body: "",
      validate: false,
    });
  }
}
