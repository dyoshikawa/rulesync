import { join } from "node:path";

import { ZCODE_DIR, ZCODE_RULE_FILE_NAME } from "../../constants/zcode-paths.js";
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

export type ZcodeRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for ZCode, Z.ai's Agentic Development Environment.
 *
 * ZCode reads exactly two instruction files: the user global
 * `~/.zcode/AGENTS.md` and the workspace `AGENTS.md` at the project root,
 * appended in that order. The docs are explicit that it "does not merge
 * multiple `AGENTS.md` files across directory levels" and "does not scan child
 * directories", so — unlike the AGENTS.md standard target — there is no nested
 * rules surface to emit and rulesync's topic-based non-root rules are folded
 * into the single root file by the RulesProcessor (`nonRoot` is `undefined`).
 * `CLAUDE.md` is deliberately not written: ZCode reads it only once, during
 * onboarding, as a migration source.
 *
 * @see https://zcode.z.ai/en/docs/agents
 */
export type ZcodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class ZcodeRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: ZcodeRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
    excludeToolDir?: boolean;
  } = {}): ZcodeRuleSettablePaths {
    return {
      root: {
        // The workspace file sits at the project root; the user file sits
        // inside the profile directory, which the processor reaches by
        // supplying the home directory as outputRoot.
        relativeDirPath: global ? ZCODE_DIR : ".",
        relativeFilePath: ZCODE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ZcodeRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new ZcodeRule({
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
  }: ToolRuleFromRulesyncRuleParams): ZcodeRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new ZcodeRule({
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
  }: ToolRuleForDeletionParams): ZcodeRule {
    const isRoot =
      relativeFilePath === ZCODE_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === ZCODE_DIR);

    return new ZcodeRule({
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
      toolTarget: "zcode",
    });
  }
}
