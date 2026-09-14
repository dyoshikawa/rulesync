import { join } from "node:path";

import { CORTEXCODE_RULE_FILE_NAME } from "../../constants/cortexcode-paths.js";
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

export type CortexcodeRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for Snowflake Cortex Code.
 *
 * The Cortex Code CLI documents `AGENTS.md` at the project root as its
 * instruction file ("Support for AGENTS.md files and Agent Skills"). No nested
 * rule directory and no user-scoped rule file are documented for the CLI, so
 * rulesync's topic-based non-root rules are folded into the single root
 * `AGENTS.md` by the RulesProcessor (`nonRoot` is `undefined`, mirroring the
 * codexcli and warp targets) and the target is project-only.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/cortex-code
 */
export type CortexcodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class CortexcodeRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: CortexcodeRuleParams) {
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
  ): CortexcodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: CORTEXCODE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<CortexcodeRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new CortexcodeRule({
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
  }: ToolRuleFromRulesyncRuleParams): CortexcodeRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new CortexcodeRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      root: isRoot,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return this.toRulesyncRuleDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolRuleForDeletionParams): CortexcodeRule {
    const isRoot = relativeFilePath === CORTEXCODE_RULE_FILE_NAME && relativeDirPath === ".";

    return new CortexcodeRule({
      outputRoot,
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
      toolTarget: "cortexcode",
    });
  }
}
