import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { readFileContent } from "../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

export type CodexcliRuleSettablePaths = ToolRuleSettablePaths & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
};

export type CodexcliRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Rule generator for OpenAI Codex CLI
 *
 * Generates AGENTS.md files based on rulesync rule content.
 * Supports the OpenAI Codex CLI memory/instructions system with
 * hierarchical loading (global, project, directory-specific).
 */
export class CodexcliRule extends ToolRule {
  static getSettablePaths(): CodexcliRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: ".codex/memories",
      },
    };
  }

  static getSettablePathsGlobal(): CodexcliRuleSettablePathsGlobal {
    return {
      root: {
        relativeDirPath: ".codex",
        relativeFilePath: "AGENTS.md",
      },
    };
  }

  static async fromFile({
    baseDir = ".",
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<CodexcliRule> {
    const paths = this.getSettablePaths();
    const isRoot = relativeFilePath === "AGENTS.md";
    const relativePath = isRoot
      ? "AGENTS.md"
      : join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));

    return new CodexcliRule({
      baseDir,
      relativeDirPath: isRoot ? paths.root.relativeDirPath : paths.nonRoot.relativeDirPath,
      relativeFilePath: isRoot ? "AGENTS.md" : relativeFilePath,
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
  }: ToolRuleFromRulesyncRuleParams): CodexcliRule {
    const paths = global ? this.getSettablePathsGlobal() : this.getSettablePaths();
    return new CodexcliRule(
      this.buildToolRuleParamsAgentsmd({
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
    // OpenAI Codex CLI rules are always valid since they don't have complex frontmatter
    // The body content can be empty (though not recommended in practice)
    // This follows the same pattern as other rule validation methods
    return { success: true, error: null };
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "codexcli",
    });
  }
}
