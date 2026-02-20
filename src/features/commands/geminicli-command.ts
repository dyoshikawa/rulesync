import { join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";

import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandForDeletionParams,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
} from "./tool-command.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3)
export const GeminiCliCommandFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  prompt: z.string(),
});

export type GeminiCliCommandFrontmatter = z.infer<typeof GeminiCliCommandFrontmatterSchema>;

export type GeminiCliCommandParams = {
  frontmatter: GeminiCliCommandFrontmatter;
  body: string;
} & AiFileParams;

export class GeminiCliCommand extends ToolCommand {
  private readonly frontmatter: GeminiCliCommandFrontmatter;
  private readonly body: string;

  constructor(params: AiFileParams) {
    super(params);
    const parsed = this.parseTomlContent(this.fileContent);
    this.frontmatter = parsed;
    this.body = parsed.prompt;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolCommandSettablePaths {
    return {
      relativeDirPath: join(".gemini", "commands"),
    };
  }

  private parseTomlContent(content: string): GeminiCliCommandFrontmatter {
    try {
      const parsed = parseToml(content);
      const result = GeminiCliCommandFrontmatterSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
      // Preserve all fields including unknown ones (looseObject passthrough)
      return {
        ...result.data,
        description: result.data.description || "",
      };
    } catch (error) {
      throw new Error(
        `Failed to parse TOML command file (${join(this.relativeDirPath, this.relativeFilePath)}): ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return {
      description: this.frontmatter.description,
      prompt: this.frontmatter.prompt,
    };
  }

  toRulesyncCommand(): RulesyncCommand {
    const { description, prompt: _prompt, ...restFields } = this.frontmatter;

    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["geminicli"],
      description: description ?? "",
      // Preserve extra fields in geminicli section (excluding prompt which is the body)
      ...(Object.keys(restFields).length > 0 && { geminicli: restFields }),
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: process.cwd(), // RulesyncCommand baseDir is always the project root directory
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
  }: ToolCommandFromRulesyncCommandParams): GeminiCliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge geminicli-specific fields from rulesync frontmatter
    const geminicliFields = rulesyncFrontmatter.geminicli ?? {};

    const geminiFrontmatter: GeminiCliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: rulesyncCommand.getBody(),
      ...geminicliFields,
    };

    // Generate proper file content with TOML format
    // Note: TOML format only supports description and prompt fields
    // Extra fields from geminicli section are stored in the object but not serialized to TOML
    const tomlContent = `description = "${geminiFrontmatter.description}"
prompt = """
${geminiFrontmatter.prompt}
"""`;

    const paths = this.getSettablePaths({ global });

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GeminiCliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath,
      fileContent,
      validate,
    });
  }

  validate(): ValidationResult {
    try {
      this.parseTomlContent(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  static isTargetedByRulesyncCommand(rulesyncCommand: RulesyncCommand): boolean {
    return this.isTargetedByRulesyncCommandDefault({
      rulesyncCommand,
      toolTarget: "geminicli",
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GeminiCliCommand {
    // Provide minimal valid TOML to pass constructor parsing.
    // The constructor always calls parseTomlContent(), so we need valid TOML even for deletion.
    const placeholderToml = `description = ""
prompt = ""`;
    return new GeminiCliCommand({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholderToml,
      validate: false,
    });
  }
}
