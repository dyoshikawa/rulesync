import { join } from "node:path";

import { CODEBUFF_GLOBAL_RULE_FILE_NAME } from "../../constants/codebuff-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

/**
 * Rule generator for Codebuff (Freebuff), global scope only.
 *
 * Codebuff reads one user-level instructions file from the home directory:
 * the first hidden file matching `AGENTS.md` or `CLAUDE.md` (case-insensitive,
 * in that priority order), so the root rule is written to `~/.AGENTS.md`. There
 * is no user-level rules directory, so non-root rules fold into that file.
 *
 * Project scope is not supported here: Codebuff reads the project-root
 * `AGENTS.md`, which the `agentsmd` target already writes. The RulesProcessor
 * keeps this target out of project mode (`supportsProject: false`), so the
 * settable paths are the home-directory ones regardless of `global`.
 *
 * @see https://github.com/CodebuffAI/freebuff/blob/main/sdk/src/run-state.ts
 * @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/constants/knowledge.ts
 */
export class CodebuffRule extends ToolRule {
  static getSettablePaths(
    _options: { global?: boolean; excludeToolDir?: boolean } = {},
  ): ToolRuleSettablePathsGlobal {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CODEBUFF_GLOBAL_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<CodebuffRule> {
    const { root } = this.getSettablePaths({ global: true });
    if (relativeFilePath !== root.relativeFilePath) {
      throw new Error(`CodebuffRule only supports the root rule: ${relativeFilePath}`);
    }

    const fileContent = await readFileContent(
      join(outputRoot, root.relativeDirPath, root.relativeFilePath),
    );
    return new CodebuffRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): CodebuffRule {
    // Every rule targets the single `~/.AGENTS.md`; the RulesProcessor folds
    // the non-root bodies into the root rule.
    const { root } = this.getSettablePaths({ global: true });
    const frontmatter = rulesyncRule.getFrontmatter();
    return new CodebuffRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: frontmatter.root ?? false,
      description: frontmatter.description,
      globs: frontmatter.globs,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    // Codebuff instructions files are plain markdown without frontmatter.
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): CodebuffRule {
    const { root } = this.getSettablePaths({ global: true });
    return new CodebuffRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: relativeDirPath === root.relativeDirPath && relativeFilePath === root.relativeFilePath,
    });
  }

  protected static override readonly toolTarget = "codebuff";
}
