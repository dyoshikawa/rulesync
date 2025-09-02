import { readFile } from "node:fs/promises";
import { basename } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod/mini";
import type { AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ParsedCommand } from "../types/commands.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFilePathParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

export const GeminiCliCommandFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  prompt: z.string(),
});

export type GeminiCliCommandFrontmatter = {
  description: string;
  prompt: string;
};

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

  private parseTomlContent(content: string): GeminiCliCommandFrontmatter {
    try {
      const parsed = parseToml(content);
      const validated = GeminiCliCommandFrontmatterSchema.parse(parsed);
      return {
        description: validated.description || "",
        prompt: validated.prompt,
      };
    } catch (error) {
      throw new Error(`Failed to parse TOML command file: ${error}`);
    }
  }

  protected parseCommandFile(content: string): ParsedCommand {
    const parsed = this.parseTomlContent(content);
    return {
      filename: "unknown.toml",
      filepath: "unknown.toml",
      frontmatter: {
        description: parsed.description,
      },
      content: parsed.prompt,
    };
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
    const rulesyncFrontmatter: RulesyncCommandFrontmatter = {
      targets: ["geminicli"],
      description: this.frontmatter.description,
    };

    // Generate proper file content with Rulesync specific frontmatter
    const fileContent = stringifyFrontmatter(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): GeminiCliCommand {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const geminiFrontmatter: GeminiCliCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
      prompt: rulesyncCommand.getBody(),
    };

    // Generate proper file content with TOML format
    const tomlContent = `description = "${geminiFrontmatter.description}"
prompt = """
${geminiFrontmatter.prompt}
"""`;

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: ".gemini/commands",
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFilePath({
    baseDir = ".",
    filePath,
    validate = true,
  }: ToolCommandFromFilePathParams): Promise<GeminiCliCommand> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: ".gemini/commands",
      relativeFilePath: basename(filePath),
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

  private async processContent(content: string, args?: string): Promise<string> {
    let processedContent = content;

    // Process {{args}} placeholder
    processedContent = this.processArgumentPlaceholder(processedContent, args);

    // NOTE: Shell command execution feature removed for security reasons
    // Commands with !{ } syntax will be left as-is in the output

    return processedContent;
  }

  private processArgumentPlaceholder(content: string, args?: string): string {
    if (content.includes("{{args}}")) {
      // If {{args}} placeholder exists, replace it with arguments
      return content.replace(/\{\{args\}\}/g, args || "");
    }

    // If no {{args}} placeholder and arguments are provided, append arguments
    if (args) {
      return `${content}\n\n${args}`;
    }

    return content;
  }
}
