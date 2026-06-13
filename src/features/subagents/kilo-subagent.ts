import { join } from "node:path";

import { z } from "zod/mini";

import {
  KILO_AGENTS_DIR_PATH,
  KILO_GLOBAL_AGENTS_DIR_PATH,
} from "../../constants/kilo-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
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

/** Default `mode` applied to Kilo subagents (single source of truth). */
export const KILO_DEFAULT_MODE = "all";

export const KiloSubagentFrontmatterSchema = z.looseObject({
  description: z.optional(z.string()),
  mode: z._default(z.string(), KILO_DEFAULT_MODE),
  name: z.optional(z.string()),
  displayName: z.optional(z.string()),
  deprecated: z.optional(z.boolean()),
  native: z.optional(z.boolean()),
  hidden: z.optional(z.boolean()),
  top_p: z.optional(z.number()),
  temperature: z.optional(z.number()),
  color: z.optional(z.string()),
  // Kilo custom modes accept a per-tool permission object (`{ <tool>: { allow,
  // deny, ask } }`, glob-aware), in addition to a bare string. Accept both so an
  // object value is no longer rejected. https://kilo.ai/docs/customize/custom-modes
  permission: z.optional(z.union([z.string(), z.record(z.string(), z.unknown())])),
  model: z.optional(z.string()),
  variant: z.optional(z.string()),
  prompt: z.optional(z.string()),
  options: z.optional(z.record(z.string(), z.unknown())),
  steps: z.optional(z.array(z.record(z.string(), z.unknown()))),
  disable: z.optional(z.boolean()),
});
export type KiloSubagentFrontmatter = z.infer<typeof KiloSubagentFrontmatterSchema>;
export type KiloSubagentParams = Omit<OpenCodeStyleSubagentParams, "frontmatter"> & {
  frontmatter: KiloSubagentFrontmatter;
};

export class KiloSubagent extends OpenCodeStyleSubagent {
  declare protected readonly frontmatter: KiloSubagentFrontmatter;

  constructor(params: KiloSubagentParams) {
    // Apply the Kilo schema (which also fills the `mode` default) up front so the
    // stored frontmatter is normalized and `validate()` can stay side-effect-free.
    // Kilo's schema is a strict superset of the parent's, so the parent's own
    // validation is redundant — pass `validate: false` to skip it (the check has
    // already happened here).
    let frontmatter = params.frontmatter;
    if (params.validate !== false) {
      const result = KiloSubagentFrontmatterSchema.safeParse(params.frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(params.relativeDirPath, params.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
      frontmatter = result.data;
    }

    super({ ...params, frontmatter, validate: false });
  }

  protected getToolTarget(): Extract<ToolTarget, "opencode" | "kilo"> {
    return "kilo";
  }

  getFrontmatter(): KiloSubagentFrontmatter {
    return this.frontmatter;
  }

  /**
   * Pure validation (matches every sibling subagent): checks the stored
   * frontmatter against the Kilo schema without mutating it. Default application
   * happens in the constructor, not here.
   */
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
      relativeDirPath: global ? KILO_GLOBAL_AGENTS_DIR_PATH : KILO_AGENTS_DIR_PATH,
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

    const parseResult = KiloSubagentFrontmatterSchema.safeParse({
      ...kiloSection,
      description: rulesyncFrontmatter.description,
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    });

    if (!parseResult.success) {
      throw new Error(
        `Invalid frontmatter in ${rulesyncSubagent.getRelativeFilePath()}: ${formatError(parseResult.error)}`,
      );
    }
    const kiloFrontmatter: KiloSubagentFrontmatter = parseResult.data;

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
      frontmatter: { description: "", mode: KILO_DEFAULT_MODE },
      body: "",
      fileContent: "",
      validate: false,
      global,
    });
  }
}
