import { join } from "node:path";

import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
import {
  OpenCodeStyleSubagent,
  OpenCodeStyleSubagentFrontmatter,
  OpenCodeStyleSubagentFrontmatterSchema,
  OpenCodeStyleSubagentParams,
} from "./opencode-style-subagent.js";
import { RulesyncSubagent } from "./rulesync-subagent.js";
import {
  ToolSubagent,
  ToolSubagentForDeletionParams,
  ToolSubagentFromFileParams,
  ToolSubagentFromRulesyncSubagentParams,
  ToolSubagentSettablePaths,
} from "./tool-subagent.js";

export const KiloSubagentFrontmatterSchema = OpenCodeStyleSubagentFrontmatterSchema;
export type KiloSubagentFrontmatter = OpenCodeStyleSubagentFrontmatter;
export type KiloSubagentParams = OpenCodeStyleSubagentParams;

export class KiloSubagent extends OpenCodeStyleSubagent {
  protected getToolTarget(): Extract<ToolTarget, "opencode" | "kilo"> {
    return "kilo";
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

    const kiloFrontmatter: KiloSubagentFrontmatter = {
      ...kiloSection,
      description: rulesyncFrontmatter.description,
      // Kilo CLI's documented default for user-defined agents is "all"
      // (available both as a top-level pick AND as a subagent). See
      // https://kilocode.ai/docs/customize/custom-modes — "mode" reference:
      //   all — Available both as a top-level pick and as a subagent
      //         (default for user-defined agents).
      // Previously this defaulted to "subagent", which hid generated
      // agents from Kilo's agent picker. The explicit `kilo.mode` override
      // in source frontmatter still wins, so users wanting subagent-only
      // can opt in with `kilo: { mode: subagent }`.
      mode: typeof kiloSection.mode === "string" ? kiloSection.mode : "all",
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    };

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
  }: ToolSubagentForDeletionParams): KiloSubagent {
    return new KiloSubagent({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
