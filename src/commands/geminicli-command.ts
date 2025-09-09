import { basename, join } from "node:path";
import { parse as parseToml } from "smol-toml";
import { z } from "zod/mini";
import type { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
  ToolCommandSettablePaths,
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

  static getSettablePaths(): ToolCommandSettablePaths {
    return {
      relativeDirPath: ".gemini/commands",
    };
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
      relativeDirPath: RulesyncCommand.getSettablePaths().relativeDirPath,
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
      relativeDirPath: GeminiCliCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<GeminiCliCommand> {
    const filePath = join(
      baseDir,
      GeminiCliCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    // Read file content
    const fileContent = await readFileContent(filePath);

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: GeminiCliCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
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
}
