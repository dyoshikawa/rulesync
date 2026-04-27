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

// Translate rulesync universal command syntax (Claude Code compatible) into
// Gemini CLI's native syntax. See docs/reference/command-syntax.md.
function translateRulesyncBodyToGemini(body: string): string {
  return body.replace(/!`([^`\n]+)`/g, "!{$1}").replace(/\$ARGUMENTS\b/g, "{{args}}");
}

// Inverse of translateRulesyncBodyToGemini, used when importing a Gemini CLI
// command file back into rulesync's universal syntax.
function translateGeminiBodyToRulesync(body: string): string {
  return body.replace(/!\{([^}\n]+)\}/g, "!`$1`").replace(/\{\{\s*args\s*\}\}/g, "$ARGUMENTS");
}

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
        description: result.data.description,
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
      description: description,
      // Preserve extra fields in geminicli section (excluding prompt which is the body)
      ...(Object.keys(restFields).length > 0 && { geminicli: restFields }),
    };

    const universalBody = translateGeminiBodyToRulesync(this.body);

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(universalBody, rulesyncFrontmatter);

    return new RulesyncCommand({
      outputRoot: process.cwd(), // RulesyncCommand outputRoot is always the project root directory
      frontmatter: rulesyncFrontmatter,
      body: universalBody,
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
  }: ToolCommandFromRulesyncCommandParams): GeminiCliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    // Merge geminicli-specific fields from rulesync frontmatter
    const geminicliFields = rulesyncFrontmatter.geminicli ?? {};

    // Translate universal command syntax to Gemini CLI's native syntax. If the
    // user provided an explicit `geminicli.prompt` override, respect it as-is to
    // avoid double-translation when they intentionally hand-write Gemini syntax.
    const translatedPrompt = translateRulesyncBodyToGemini(rulesyncCommand.getBody());

    const geminiFrontmatter: GeminiCliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: translatedPrompt,
      ...geminicliFields,
    };

    // Generate proper file content with TOML format
    // Note: TOML format only supports description and prompt fields
    // Extra fields from geminicli section are stored in the object but not serialized to TOML
    const descriptionLine =
      geminiFrontmatter.description !== undefined
        ? `description = "${geminiFrontmatter.description}"\n`
        : "";
    const tomlContent = `${descriptionLine}prompt = """
${geminiFrontmatter.prompt}
"""`;

    const paths = this.getSettablePaths({ global });

    return new GeminiCliCommand({
      outputRoot: outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolCommandFromFileParams): Promise<GeminiCliCommand> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new GeminiCliCommand({
      outputRoot: outputRoot,
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
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolCommandForDeletionParams): GeminiCliCommand {
    // Provide minimal valid TOML to pass constructor parsing.
    // The constructor always calls parseTomlContent(), so we need valid TOML even for deletion.
    const placeholderToml = `description = ""
prompt = ""`;
    return new GeminiCliCommand({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: placeholderToml,
      validate: false,
    });
  }
}
