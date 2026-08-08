import { join } from "node:path";

import { MUSECODE_RULE_FILE_NAME } from "../../constants/musecode-paths.js";
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

export type MusecodeRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for Meta Muse Code.
 *
 * Muse Code loads project instructions from the `AGENTS.md` family: it walks up
 * from the working directory to the `.git` boundary and loads one instruction
 * file per directory level, preferring `AGENTS.md` over `CLAUDE.md` when both
 * exist. rulesync emits the project-root `AGENTS.md` (the same shared root file
 * the agentsmd/codexcli targets write). Muse Code has user/global rules, but
 * their path is not documented, so no global scope is supported here.
 * (Verified against the official docs:
 * https://dev.meta.ai/docs/muse-code/configuration.md)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map
 * onto, so their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor; there is no separate non-root output location (`nonRoot` is
 * `undefined`). This mirrors the codexcli and warp targets.
 */
export type MusecodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class MusecodeRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: MusecodeRuleParams) {
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
  ): MusecodeRuleSettablePaths {
    // Project scope only: the global rules path is undocumented, so `global`
    // is deliberately ignored (supportsGlobal is false in the processor).
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: MUSECODE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<MusecodeRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new MusecodeRule({
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
  }: ToolRuleFromRulesyncRuleParams): MusecodeRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new MusecodeRule({
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
  }: ToolRuleForDeletionParams): MusecodeRule {
    const isRoot = relativeFilePath === MUSECODE_RULE_FILE_NAME && relativeDirPath === ".";

    return new MusecodeRule({
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
      toolTarget: "musecode",
    });
  }
}
