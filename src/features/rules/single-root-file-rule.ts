import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePathsGlobal,
} from "./tool-rule.js";

/**
 * Base for tools whose rules live in exactly one plain-Markdown root file with
 * no non-root output location (`nonRoot` is `undefined`): the RulesProcessor
 * folds non-root rule bodies into that root file.
 *
 * Every rule, whatever its source path, maps to the subclass's
 * `getSettablePaths().root`; the file has no frontmatter, so validation always
 * succeeds. A subclass supplies `getSettablePaths` and `toolTarget`, and
 * overrides {@link SingleRootFileRule.isRootFilePath} when more than the
 * settable root path counts as the root file on deletion.
 */
export class SingleRootFileRule extends ToolRule {
  static getSettablePaths(
    _options: { global?: boolean; excludeToolDir?: boolean } = {},
  ): ToolRuleSettablePathsGlobal {
    throw new Error("Please implement this method in the subclass.");
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<SingleRootFileRule> {
    // Only the single root file exists, so the incoming path is ignored.
    const { root } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, root.relativeDirPath, root.relativeFilePath),
    );

    return new this({
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
    global = false,
  }: ToolRuleFromRulesyncRuleParams): SingleRootFileRule {
    const { root } = this.getSettablePaths({ global });

    // Root and non-root rules both target the single root file; the
    // RulesProcessor folds the non-root bodies into the root rule.
    return new this({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: rulesyncRule.getFrontmatter().root ?? false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /** Whether a path found on deletion is the tool's root file. */
  protected static isRootFilePath({
    relativeDirPath,
    relativeFilePath,
    global,
  }: {
    relativeDirPath: string;
    relativeFilePath: string;
    global: boolean;
  }): boolean {
    const { root } = this.getSettablePaths({ global });
    return relativeFilePath === root.relativeFilePath && relativeDirPath === root.relativeDirPath;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): SingleRootFileRule {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: this.isRootFilePath({ relativeDirPath, relativeFilePath, global }),
    });
  }
}
