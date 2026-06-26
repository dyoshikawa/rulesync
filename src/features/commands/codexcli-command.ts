import { join } from "node:path";

import { z } from "zod/mini";

import { CODEXCLI_PROMPTS_DIR_PATH } from "../../constants/codexcli-paths.js";
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

// looseObject preserves unknown keys during parsing so future Codex frontmatter
// additions survive a round trip. https://developers.openai.com/codex/custom-prompts
const CodexcliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type CodexcliCommandFrontmatter = z.infer<typeof CodexcliCommandFrontmatterSchema>;

export type CodexcliCommandParams = {
  frontmatter: CodexcliCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export class CodexcliCommand extends ToolCommand {
  private readonly frontmatter: CodexcliCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: CodexcliCommandParams) {
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate) {
      const result = CodexcliCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    // Only emit frontmatter when at least one field is present so prompts without
    // metadata stay as plain Markdown bodies.
    const hasFrontmatter = Object.keys(frontmatter ?? {}).length > 0;

    super({
      ...rest,
      fileContent: hasFrontmatter ? stringifyFrontmatter(body, frontmatter) : body,
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolCommandSettablePaths {
    if (!global) {
      throw new Error("CodexcliCommand only supports global mode. Please pass { global: true }.");
    }
    return {
      relativeDirPath: CODEXCLI_PROMPTS_DIR_PATH,
    };
  }

  getFrontmatter(): CodexcliCommandFrontmatter {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["*"],
      ...(description !== undefined && { description }),
      // Preserve Codex-specific fields (e.g. argument-hint) in the codexcli section.
      ...(Object.keys(restFields).length > 0 && { codexcli: restFields }),
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
    global = false,
  }: ToolCommandFromRulesyncCommandParams): CodexcliCommand {
    const paths = this.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge codexcli-specific fields (e.g. argument-hint) from rulesync frontmatter.
    const codexcliFields = rulesyncFrontmatter.codexcli ?? {};

    const codexcliFrontmatter: CodexcliCommandFrontmatter = {
      ...(rulesyncFrontmatter.description !== undefined && {
        description: rulesyncFrontmatter.description,
      }),
      ...codexcliFields,
    };

    return new CodexcliCommand({
      outputRoot: outputRoot,
      frontmatter: codexcliFrontmatter,
      body: rulesyncCommand.getBody(),
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

    const result = CodexcliCommandFrontmatterSchema.safeParse(this.frontmatter);
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

  getBody(): string {
    return this.body;
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "codexcli",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<CodexcliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);

    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = CodexcliCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new CodexcliCommand({
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
  }: ToolCommandForDeletionParams): CodexcliCommand {
    return new CodexcliCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: {},
      body: "",
      validate: false,
    });
  }
}
