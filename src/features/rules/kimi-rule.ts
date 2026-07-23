import { join } from "node:path";

import { AGENTSMD_DIR } from "../../constants/agentsmd-paths.js";
import { KIMI_DIR, KIMI_RULE_FILE_NAME } from "../../constants/kimi-paths.js";
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

export type KimiRuleParams = AiFileParams & {
  root?: boolean;
};

/**
 * Project paths: the root memory file is `.kimi-code/AGENTS.md`, with the
 * project-root `./AGENTS.md` accepted as an alternative on import (the AGENTS
 * open standard). Kimi Code has no non-root instruction directory, so topic
 * rules are folded into the single root `AGENTS.md` by the RulesProcessor
 * (`foldsNonRootIntoRoot`, `nonRoot` is `undefined`).
 */
export type KimiRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  alternativeRoots?: Array<{
    relativeDirPath: string;
    relativeFilePath: string;
  }>;
  nonRoot?: undefined;
};

/**
 * Rule generator for Kimi Code (Moonshot AI).
 *
 * Kimi Code reads an `AGENTS.md` memory file: project `.kimi-code/AGENTS.md`
 * (canonical output, with `./AGENTS.md` accepted on import) and global
 * `~/.agents/AGENTS.md`. There is no non-root instruction directory, so
 * rulesync's topic rules are folded into the single root file.
 */
export class KimiRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: KimiRuleParams) {
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
  } = {}): KimiRuleSettablePaths {
    if (global) {
      return {
        root: {
          relativeDirPath: AGENTSMD_DIR,
          relativeFilePath: KIMI_RULE_FILE_NAME,
        },
      };
    }
    return {
      root: {
        relativeDirPath: KIMI_DIR,
        relativeFilePath: KIMI_RULE_FILE_NAME,
      },
      alternativeRoots: [{ relativeDirPath: ".", relativeFilePath: KIMI_RULE_FILE_NAME }],
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    relativeFilePath,
    relativeDirPath: overrideDirPath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<KimiRule> {
    const { root } = this.getSettablePaths({ global });
    const relativeDirPath = overrideDirPath ?? root.relativeDirPath;

    if (relativeFilePath !== KIMI_RULE_FILE_NAME) {
      throw new Error(
        `Kimi rules support only AGENTS.md, got: ${join(relativeDirPath, relativeFilePath)}`,
      );
    }

    const fileContent = await readFileContent(join(outputRoot, relativeDirPath, relativeFilePath));

    return new KimiRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
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
  }: ToolRuleFromRulesyncRuleParams): KimiRule {
    const { root } = this.getSettablePaths({ global });
    const isRoot = rulesyncRule.getFrontmatter().root ?? false;

    return new KimiRule({
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
  }: ToolRuleForDeletionParams): KimiRule {
    return new KimiRule({
      outputRoot,
      relativeDirPath: relativeDirPath ?? KIMI_DIR,
      relativeFilePath: relativeFilePath ?? KIMI_RULE_FILE_NAME,
      fileContent: "",
      validate: false,
      root: relativeFilePath === KIMI_RULE_FILE_NAME,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kimi",
    });
  }
}
