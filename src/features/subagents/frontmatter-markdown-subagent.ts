import { join } from "node:path";

import type { z } from "zod/mini";

import { RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import {
  parseFrontmatter,
  stringifyFrontmatter,
  validateFrontmatterSchema,
} from "../../utils/frontmatter.js";
import { RulesyncSubagent, type RulesyncSubagentFrontmatter } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  type ToolSubagentForDeletionParams,
  type ToolSubagentFromFileParams,
  type ToolSubagentFromRulesyncSubagentParams,
  type ToolSubagentSettablePaths,
} from "./tool-subagent.js";

/** The frontmatter shape every tool schema of this kind accepts. */
export type FrontmatterMarkdownToolSubagentFrontmatter = {
  name: string;
  description?: string;
} & Record<string, unknown>;

export type FrontmatterMarkdownToolSubagentParams<
  TFrontmatter extends FrontmatterMarkdownToolSubagentFrontmatter =
    FrontmatterMarkdownToolSubagentFrontmatter,
> = {
  frontmatter: TFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent"> & { fileContent?: string };

/**
 * Base class for targets whose subagent is one Markdown file per agent with a
 * YAML frontmatter block, validated by a tool-specific schema, and whose extra
 * frontmatter keys round-trip through the `<toolTarget>:` section of the
 * Rulesync subagent.
 *
 * Subclasses provide `getSettablePaths`, `getToolTarget` and
 * `getFrontmatterSchema`, and may override `toToolFrontmatter` where the
 * generated frontmatter differs from the default.
 */
export class FrontmatterMarkdownToolSubagent<
  TFrontmatter extends FrontmatterMarkdownToolSubagentFrontmatter =
    FrontmatterMarkdownToolSubagentFrontmatter,
> extends ToolSubagent {
  protected readonly frontmatter: TFrontmatter;
  protected readonly body: string;

  constructor({
    frontmatter,
    body,
    fileContent,
    ...rest
  }: FrontmatterMarkdownToolSubagentParams<TFrontmatter>) {
    if (rest.validate !== false) {
      const result = validateFrontmatterSchema({
        schema: new.target.getFrontmatterSchema(),
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
      fileContent: fileContent ?? stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSubagentSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  /** The tool target, also the key of the tool's section in the Rulesync frontmatter. */
  protected static getToolTarget(): ToolTarget {
    throw new Error("Please implement this method in the subclass.");
  }

  protected static getFrontmatterSchema(): z.ZodMiniType<FrontmatterMarkdownToolSubagentFrontmatter> {
    throw new Error("Please implement this method in the subclass.");
  }

  /** The tool frontmatter emitted for a Rulesync subagent. */
  protected static toToolFrontmatter({
    rulesyncSubagent,
  }: Pick<
    ToolSubagentFromRulesyncSubagentParams,
    "rulesyncSubagent" | "logger"
  >): FrontmatterMarkdownToolSubagentFrontmatter {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const toolSection = rulesyncFrontmatter[this.getToolTarget()] ?? {};

    return {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...toolSection,
    };
  }

  getFrontmatter(): TFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  toRulesyncSubagent(): RulesyncSubagent {
    const toolTarget = (this.constructor as typeof FrontmatterMarkdownToolSubagent).getToolTarget();
    const { name, description, ...rest } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncSubagentFrontmatter = {
      targets: ["*"] as const,
      name,
      description,
      [toolTarget]: {
        ...rest,
      },
    };

    return new RulesyncSubagent({
      outputRoot: ".",
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: RULESYNC_SUBAGENTS_RELATIVE_DIR_PATH,
      relativeFilePath: this.getRelativeFilePath(),
      validate: true,
    });
  }

  static override fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
    logger,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const frontmatter = this.toToolFrontmatter({ rulesyncSubagent, logger });

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, frontmatter, {
      avoidBlockScalars: true,
    });
    const paths = this.getSettablePaths({ global });

    return new this({
      outputRoot,
      frontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    return validateFrontmatterSchema({
      schema: (this.constructor as typeof FrontmatterMarkdownToolSubagent).getFrontmatterSchema(),
      frontmatter: this.frontmatter,
      relativeDirPath: this.relativeDirPath,
      relativeFilePath: this.relativeFilePath,
    });
  }

  static override isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: this.getToolTarget(),
    });
  }

  static override async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<FrontmatterMarkdownToolSubagent> {
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
      fileContent,
      validate,
      global,
    });
  }

  static override forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): FrontmatterMarkdownToolSubagent {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
