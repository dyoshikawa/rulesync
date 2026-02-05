import { join } from "node:path";

import { type AiFileFromFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type OpenCodeRuleParams = ToolRuleParams;

export type OpenCodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export class OpenCodeRule extends ToolRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): OpenCodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: _options.excludeToolDir ? "memories" : join(".opencode", "memories"),
      },
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: AiFileFromFileParams): Promise<OpenCodeRule> {
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot ? "AGENTS.md" : join(".opencode", "memories", relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new OpenCodeRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
      validate,
      root: isRoot,
      fileContent,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): OpenCodeRule {
    return new OpenCodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    );
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // OpenCode rules are always valid since they use plain markdown format
    // Similar to AgentsMdRule, no complex frontmatter validation needed
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): OpenCodeRule {
    const isRoot = relativeFilePath === "AGENTS.md" && relativeDirPath === ".";

    return new OpenCodeRule({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: isRoot,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "opencode",
    });
  }
}
