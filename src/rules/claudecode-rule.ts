import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type ClaudecodeRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ClaudecodeRuleParams = ToolRuleParams & {
  description?: string | undefined;
};

/**
 * Rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 */
export class ClaudecodeRule extends ToolRule {
  static getSettablePaths(): ClaudecodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
      },
      nonRoot: {
        relativeDirPath: ".claude/memories",
      },
    };
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<ClaudecodeRule> {
    const isRoot = relativeFilePath === this.getSettablePaths().root.relativeFilePath;
    const relativePath = isRoot
      ? this.getSettablePaths().root.relativeFilePath
      : join(this.getSettablePaths().nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath: isRoot
        ? this.getSettablePaths().root.relativeDirPath
        : this.getSettablePaths().nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? this.getSettablePaths().root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
      description: undefined,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    return new ClaudecodeRule({
      ...this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: this.getSettablePaths().nonRoot,
      }),
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "claudecode",
    });
  }

}
