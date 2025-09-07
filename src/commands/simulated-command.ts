import { basename, join } from "node:path";
import { z } from "zod/mini";
import { AiFileParams, ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../utils/frontmatter.js";
import { RulesyncCommand } from "./rulesync-command.js";
import {
  ToolCommand,
  ToolCommandFromFileParams,
  ToolCommandFromRulesyncCommandParams,
} from "./tool-command.js";

export const SimulatedCommandFrontmatterSchema = z.object({
  description: z.string(),
});

export type SimulatedCommandFrontmatter = z.infer<typeof SimulatedCommandFrontmatterSchema>;

export type SimulatedCommandParams = {
  frontmatter: SimulatedCommandFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export abstract class SimulatedCommand extends ToolCommand {
  private readonly frontmatter: SimulatedCommandFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: SimulatedCommandParams) {
    if (rest.validate) {
      const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw result.error;
      }
    }

    super({
      ...rest,
      fileContent: stringifyFrontmatter(body, frontmatter),
    });

    this.frontmatter = frontmatter;
    this.body = body;
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): Record<string, unknown> {
    return this.frontmatter;
  }

  toRulesyncCommand(): RulesyncCommand {
    throw new Error("Not implemented because it is a SIMULATED file.");
  }

  protected static fromRulesyncCommandDefault({
    baseDir = ".",
    rulesyncCommand,
    validate = true,
  }: ToolCommandFromRulesyncCommandParams): ConstructorParameters<typeof SimulatedCommand>[0] {
    const rulesyncFrontmatter = rulesyncCommand.getFrontmatter();

    const claudecodeFrontmatter: SimulatedCommandFrontmatter = {
      description: rulesyncFrontmatter.description,
    };

    const body = rulesyncCommand.getBody();

    return {
      baseDir: baseDir,
      frontmatter: claudecodeFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncCommand.getRelativeFilePath(),
      validate,
    };
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = SimulatedCommandFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return { success: false, error: result.error };
    }
  }

  protected static async fromFileDefault({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolCommandFromFileParams): Promise<ConstructorParameters<typeof SimulatedCommand>[0]> {
    const filePath = join(
      baseDir,
      SimulatedCommand.getSettablePaths().relativeDirPath,
      relativeFilePath,
    );
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = SimulatedCommandFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${result.error.message}`);
    }

    return {
      baseDir: baseDir,
      relativeDirPath: SimulatedCommand.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    };
  }
}
