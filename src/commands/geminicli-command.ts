import { execSync } from "node:child_process";
import { readFile } from "node:fs/promises";
import path from "node:path";
import matter from "gray-matter";
import { parse as parseToml } from "smol-toml";
import { z } from "zod/mini";
import type { AiFileFromFilePathParams, AiFileParams, ValidationResult } from "../types/ai-file.js";
import type { ParsedCommand } from "../types/commands.js";
import { RulesyncCommand, RulesyncCommandFrontmatter } from "./rulesync-command.js";
import { ToolCommand, ToolCommandFromRulesyncCommandParams } from "./tool-command.js";

export const GeminiCliCommandFrontmatterSchema = z.object({
  description: z.optional(z.string()),
  prompt: z.string(),
});

export interface GeminiCliCommandFrontmatter {
  description: string;
  prompt: string;
}

export interface GeminiCliCommandParams extends AiFileParams {
  frontmatter: GeminiCliCommandFrontmatter;
  body: string;
}

export class GeminiCliCommand extends ToolCommand {
  protected readonly toolName = "geminicli" as const;
  protected readonly commandsDirectoryName = "commands";
  protected readonly supportsNamespacing = true;
  protected readonly fileExtension = ".toml";

  private readonly frontmatter: GeminiCliCommandFrontmatter;
  private readonly body: string;

  constructor(params: AiFileParams) {
    super(params);
    const parsed = this.parseTomlContent(this.fileContent);
    this.frontmatter = parsed;
    this.body = parsed.prompt;
  }

  protected getGlobalCommandsDirectory(): string {
    return path.join(process.env.HOME || "~", ".gemini", "commands");
  }

  protected getProjectCommandsDirectory(): string {
    return path.join(process.cwd(), ".gemini", "commands");
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
    const fileContent = matter.stringify(this.body, rulesyncFrontmatter);

    return new RulesyncCommand({
      baseDir: this.baseDir,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      relativeDirPath: ".rulesync/commands",
      relativeFilePath: this.relativeFilePath,
      fileContent,
      validate: false,
    });
  }

  static fromRulesyncCommand({
    baseDir = ".",
    rulesyncCommand,
    relativeDirPath,
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
      relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath().replace(".md", ".toml"),
      fileContent: tomlContent,
      validate,
    });
  }

  static async fromFilePath({
    baseDir = ".",
    relativeDirPath,
    relativeFilePath,
    filePath,
    validate = true,
  }: AiFileFromFilePathParams): Promise<GeminiCliCommand> {
    // Read file content
    const fileContent = await readFile(filePath, "utf-8");

    return new GeminiCliCommand({
      baseDir: baseDir,
      relativeDirPath: relativeDirPath,
      relativeFilePath: relativeFilePath,
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

  protected async processContent(content: string, args?: string): Promise<string> {
    let processedContent = content;

    // Process {{args}} placeholder
    processedContent = this.processArgumentPlaceholder(processedContent, args);

    // Process shell commands with !{ } syntax
    processedContent = await this.expandShellCommands(processedContent);

    return processedContent;
  }

  protected processArgumentPlaceholder(content: string, args?: string): string {
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

  protected async expandShellCommands(content: string): Promise<string> {
    // Match shell command pattern: !{ command }
    const shellCommandPattern = /!\{\s*([^}]+)\s*\}/g;
    let processedContent = content;
    let match: RegExpExecArray | null;

    while ((match = shellCommandPattern.exec(content)) !== null) {
      const command = match[1]?.trim();
      if (!command) continue;
      try {
        const output = execSync(command, {
          encoding: "utf8",
          cwd: process.cwd(),
          timeout: 10000, // 10 second timeout
        });
        processedContent = processedContent.replace(match[0], output.trim());
      } catch (error) {
        // Replace with error message if command fails
        const errorMessage = `Error executing command '${command}': ${error}`;
        processedContent = processedContent.replace(match[0], errorMessage);
      }
    }

    return processedContent;
  }
}
