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
    baseDir = process.cwd(),
    rulesyncSubagent,
    validate = true,
    global = false,
  }: ToolSubagentFromRulesyncSubagentParams): ToolSubagent {
    const rulesyncFrontmatter = rulesyncSubagent.getFrontmatter();
    const kiloSection = rulesyncFrontmatter.kilo ?? {};

    const kiloFrontmatter: KiloSubagentFrontmatter = {
      ...kiloSection,
      description: rulesyncFrontmatter.description,
      mode: typeof kiloSection.mode === "string" ? kiloSection.mode : "subagent",
      ...(rulesyncFrontmatter.name && { name: rulesyncFrontmatter.name }),
    };

    const body = rulesyncSubagent.getBody();
    const fileContent = stringifyFrontmatter(body, kiloFrontmatter);
    const paths = this.getSettablePaths({ global });

    return new KiloSubagent({
      baseDir,
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
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolSubagentFromFileParams): Promise<KiloSubagent> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(baseDir, paths.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(filePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, filePath);

    const result = KiloSubagentFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${filePath}: ${formatError(result.error)}`);
    }

    return new KiloSubagent({
      baseDir,
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
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolSubagentForDeletionParams): KiloSubagent {
    return new KiloSubagent({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      frontmatter: { description: "", mode: "subagent" },
      body: "",
      fileContent: "",
      validate: false,
    });
  }
}
