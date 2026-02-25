import { basename, join } from "node:path";

import { z } from "zod/mini";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
} from "./tool-subagent.js";

export const SimulatedSubagentFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export type SimulatedSubagentFrontmatter = z.infer<typeof SimulatedSubagentFrontmatterSchema>;

export type SimulatedSubagentParams = {
  frontmatter: SimulatedSubagentFrontmatter;
  body: string;
} & Omit<AiFileParams, "fileContent">;

export abstract class SimulatedSubagent extends ToolSubagent {
  private readonly frontmatter: SimulatedSubagentFrontmatter;
  private readonly body: string;

  constructor({ frontmatter, body, ...rest }: SimulatedSubagentParams) {
    if (rest.validate) {
      const result = SimulatedSubagentFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
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

  toRulesyncSubagent(): RulesyncSubagent {
    throw new Error("Not implemented because it is a SIMULATED file.");
  }

  protected static fromRulesyncSubagentDefault({
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
  }: ToolSubagentFromRulesyncSubagentParams): ConstructorParameters<typeof SimulatedSubagent>[0] {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();

    const simulatedFrontmatter: SimulatedSubagentFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    const body = rulesyncSubagent.getBody();

    return {
      baseDir: baseDir,
      frontmatter: simulatedFrontmatter,
      body,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      validate,
    };
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = SimulatedSubagentFrontmatterSchema.safeParse(this.frontmatter);
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

  protected static async fromFileDefault({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolSubagentFromFileParams): Promise<ConstructorParameters<typeof SimulatedSubagent>[0]> {
    const filePath = join(baseDir, this.getSettablePaths().relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = SimulatedSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return {
      baseDir: baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: basename(relativeFilePath),
      frontmatter: result.data,
      body: content.trim(),
      validate,
    };
  }

  protected static forDeletionDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): ConstructorParameters<typeof SimulatedSubagent>[0] {
    return {
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { name: "", description: "" },
      body: "",
      validate: false,
    };
  }
}
