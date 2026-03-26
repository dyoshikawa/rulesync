import { join } from "node:path";

import { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  ToolRuleForDeletionParams,
  ToolRuleFromFileParams,
  ToolRuleFromRulesyncRuleParams,
  ToolRuleSettablePaths,
} from "./tool-rule.js";

export type RovodevRuleParams = AiFileParams & {
  root?: boolean;
};

export type RovodevRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
  alternativeRoots?: undefined;
};

/**
 * Rovodev rule: AGENTS.md at repo root only. No memory/non-root rules.
 * Rovodev uses AGENTS.md format; see https://developer.atlassian.com/platform/rovodev-cli/
 */
export class RovodevRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: RovodevRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths(
    _options: {
      global?: boolean;
      excludeToolDir?: boolean;
    } = {},
  ): RovodevRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: "AGENTS.md",
      },
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    relativeFilePath,
    validate = true,
  }: ToolRuleFromFileParams): Promise<RovodevRule> {
    if (relativeFilePath !== "AGENTS.md") {
      throw new Error(
        `Rovodev rules support only AGENTS.md at repo root, got: ${relativeFilePath}`,
      );
    }
    const fileContent = await readFileContent(join(baseDir, "AGENTS.md"));
    const paths = this.getSettablePaths();

    return new RovodevRule({
      baseDir,
      relativeDirPath: paths.root.relativeDirPath,
      relativeFilePath: paths.root.relativeFilePath,
      fileContent,
      validate,
      root: true,
    });
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): RovodevRule {
    return new RovodevRule({
      baseDir,
      relativeDirPath: relativeDirPath ?? ".",
      relativeFilePath: relativeFilePath ?? "AGENTS.md",
      fileContent: "",
      validate: false,
      root: true,
    });
  }

  static fromRulesyncRule({
    baseDir = process.cwd(),
    rulesyncRule,
    validate = true,
  }: ToolRuleFromRulesyncRuleParams): RovodevRule {
    if (!rulesyncRule.getFrontmatter().root) {
      throw new Error(
        "Rovodev supports only the root rule (AGENTS.md); non-root rules are not supported.",
      );
    }
    return new RovodevRule(
      this.buildToolRuleParamsDefault({
        baseDir,
        rulesyncRule,
        validate,
        rootPath: this.getSettablePaths().root,
        nonRootPath: undefined,
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
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;
    if (!isRoot) {
      return false;
    }

    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "rovodev",
    });
  }
}
