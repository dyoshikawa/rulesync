import { join } from "node:path";

import { z } from "zod/mini";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import { OpenCodeStyleSubagent, OpenCodeStyleSubagentParams } from "./opencode-style-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export const KiloSubagentFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  mode: z._default(z.string(), "subagent"),
  name: z.optional(z.string()),
  displayName: z.optional(z.string()),
  deprecated: z.optional(z.boolean()),
  native: z.optional(z.boolean()),
  hidden: z.optional(z.boolean()),
  top_p: z.optional(z.number()),
  temperature: z.optional(z.number()),
  color: z.optional(z.string()),
  permission: z.optional(z.string()),
  model: z.optional(z.string()),
  variant: z.optional(z.string()),
  prompt: z.optional(z.string()),
  options: z.optional(z.looseObject({})),
  steps: z.optional(z.array(z.looseObject({}))),
  disable: z.optional(z.boolean()),
});
export type KiloSubagentFrontmatter = z.infer<typeof KiloSubagentFrontmatterSchema>;
export type KiloSubagentParams = Omit<OpenCodeStyleSubagentParams, "frontmatter"> & {
  frontmatter: KiloSubagentFrontmatter;
};

export class KiloSubagent extends OpenCodeStyleSubagent {
  declare protected readonly frontmatter: KiloSubagentFrontmatter;

  protected getToolTarget(): Extract<ToolTarget, "opencode" | "kilo"> {
    return "kilo";
  }

  getFrontmatter(): KiloSubagentFrontmatter {
    return this.frontmatter;
  }

  validate(): ValidationResult {
    const result = KiloSubagentFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    }

    return {
      success: false,
      error: new Error(
        `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
      ),
    };
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSubagentSettablePaths {
    return {
      relativeDirPath: global ? join(".config", "kilo", "agent") : join(".kilo", "agent"),
    };
  }

  static fromRulesyncSubagent({
    outputRoot = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const kiloSection = rulesyncFrontmatter.kilo ?? {};

    const kiloFrontmatter: KiloSubagentFrontmatter = KiloSubagentFrontmatterSchema.parse({
      ...kiloSection,
      description: rulesyncFrontmatter.description,
      mode: typeof kiloSection.mode === "string" ? kiloSection.mode : "subagent",
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    });

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, kiloFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new KiloSubagent({
      outputRoot,
      frontmatter: kiloFrontmatter,
      body,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: rulesyncSubagent.getRelativeFilePath(),
      fileContent,
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSubagent(rulesyncSubagent: RulesyncSubagent): boolean {
    return this.isTargetedByRulesyncSubagentDefault({
      rulesyncSubagent,
      toolTarget: "kilo",
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiloSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KiloSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiloSubagent({
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolSubagentForDeletionParams): KiloSubagent {
    return new KiloSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
