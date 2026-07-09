import { join } from "node:path";

import { REASONIX_GLOBAL_DIR, REASONIX_RULE_FILE_NAME } from "../../constants/reasonix-paths.js";
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

export type ReasonixRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Rule generator for DeepSeek-Reasonix.
 *
 * Reasonix auto-injects a hierarchical instruction document, reading its
 * vendor-specific `REASONIX.md` (alongside the cross-tool `AGENTS.md`/`CLAUDE.md`)
 * discovered by walking user-home → ancestors → project root/local. rulesync
 * emits the vendor `REASONIX.md` at the project root (project scope) and
 * `~/.reasonix/REASONIX.md` (global scope). Like codexcli/grokcli/warp, there is
 * no non-root instruction directory to map rulesync's topic rules onto, so their
 * bodies are folded into the single root `REASONIX.md` by the RulesProcessor
 * (`nonRoot` is `undefined`).
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
export type ReasonixRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

export class ReasonixRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: ReasonixRuleParams) {
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
  } = {}): ReasonixRuleSettablePaths {
    return {
      root: {
        relativeDirPath: global ? REASONIX_GLOBAL_DIR : ".",
        relativeFilePath: REASONIX_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<ReasonixRule> {
    const { root } = this.getSettablePaths({ global });
    const relativePath = join(root.relativeDirPath, root.relativeFilePath);
    const fileContent = await readFileContent(join(outputRoot, relativePath));

    return new ReasonixRule({
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
  }: ToolRuleFromRulesyncRuleParams): ReasonixRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new ReasonixRule({
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
  }: ToolRuleForDeletionParams): ReasonixRule {
    const isRoot =
      relativeFilePath === REASONIX_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === REASONIX_GLOBAL_DIR);

    return new ReasonixRule({
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
      toolTarget: "reasonix",
    });
  }
}
