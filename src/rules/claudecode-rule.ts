import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { getHomeDirectory, readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
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

export type ClaudecodeRuleSettablePathsGlobal = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
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
        relativeDirPath: join(".claude", "memories"),
      },
    };
  }

  static getSettablePathsGlobal(): ClaudecodeRuleSettablePathsGlobal {
    return {
      root: {
        relativeDirPath: getHomeDirectory(),
        relativeFilePath: "CLAUDE.md",
      },
      nonRoot: {
        relativeDirPath: join(getHomeDirectory(), ".claude", "memories"),
      },
    };
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<ClaudecodeRule> {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === paths.root.relativeFilePath;
    const relativePath = isRoot
      ? paths.root.relativeFilePath
      : join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new ClaudecodeRule({
      baseDir,
      relativeDirPath: isRoot ? paths.root.relativeDirPath : paths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? paths.root.relativeFilePath : relativeFilePath,
      fileContent,
      validate,
      root: isRoot,
    });
  }

  static fromRulesyncRule({
    baseDir = ".",
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeRule {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();
    return new ClaudecodeRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: paths.root,
        nonRootPath: paths.nonRoot,
      }),
    );
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
