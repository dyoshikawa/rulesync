import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
  ToolRuleSettablePathsGlobal,
  buildToolPath,
} from "./tool-rule.js";

export type ClaudecodeLegacyRuleSettablePaths = Omit<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot: {
    relativeDirPath: string;
  };
};

export type ClaudecodeLegacyRuleSettablePathsGlobal = ToolRuleSettablePathsGlobal;

/**
 * Legacy rule generator for Claude Code AI assistant
 *
 * Generates CLAUDE.md memory files based on rulesync rule content.
 * Supports the Claude Code memory system with import references.
 *
 * Legacy format:
 * - {project}/CLAUDE.md (root: true)
 * - {project}/.claude/memories/*.md (root: false)
 * - {project}/CLAUDE.md references to {project}/.claude/memories/*.md using `@` syntax
 */
export class ClaudecodeLegacyRule extends ToolRule {
  static getSettablePaths({
    global,
    excludeToolDir,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ClaudecodeLegacyRuleSettablePaths | ClaudecodeLegacyRuleSettablePathsGlobal {
    if (global) {
      return {
        root: {
          relativeDirPath: buildToolPath(".claude", ".", excludeToolDir),
          relativeFilePath: "CLAUDE.md",
        },
      };
    }
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "CLAUDE.md",
      },
      nonRoot: {
        relativeDirPath: buildToolPath(".claude", "memories", excludeToolDir),
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ClaudecodeLegacyRule> {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    if (isRoot) {
      const relativePath = paths.root.relativeFilePath;
      const fileContent = await readFileContent(
        join(baseDir, paths.root.relativeDirPath, relativePath),
      );

      return new ClaudecodeLegacyRule({
        baseDir,
        relativeDirPath: paths.root.relativeDirPath,
        relativeFilePath: paths.root.relativeFilePath,
        fileContent,
        validate,
        root: true,
      });
    }

    if (!paths.nonRoot) {
      throw new Error(`nonRoot path is not set for ${relativeFilePath}`);
    }

    const relativePath = join(paths.nonRoot.relativeDirPath, relativeFilePath);
    const fileContent = await readFileContent(join(baseDir, relativePath));
    return new ClaudecodeLegacyRule({
      baseDir,
      relativeDirPath: paths.nonRoot.relativeDirPath,
      relativeFilePath: relativeFilePath,
      fileContent,
      validate,
      root: false,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): ClaudecodeLegacyRule {
    const paths = this.getSettablePaths({ global });
    return new ClaudecodeLegacyRule(
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

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): ClaudecodeLegacyRule {
    const paths = this.getSettablePaths({ global });
    const isRoot = relativeFilePath === paths.root.relativeFilePath;

    return new ClaudecodeLegacyRule({
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
      toolTarget: "claudecode-legacy",
    });
  }
}
