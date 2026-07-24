import { join } from "node:path";

import { KIMI_CODE_RULE_FILE_NAME } from "../../constants/kimi-code-paths.js";
import {
  RULESYNC_OVERVIEW_FILE_NAME,
  RULESYNC_RULES_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import {
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import { RulesyncRule } from "./rulesync-rule.js";
import {
  ToolRule,
  type ToolRuleForDeletionParams,
  type ToolRuleFromFileParams,
  type ToolRuleFromRulesyncRuleParams,
  type ToolRuleSettablePaths,
} from "./tool-rule.js";

type KimiCodeRuleParams = AiFileParams & {
  root?: boolean;
};

type KimiCodeRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * Kimi Code instruction file.
 *
 * Kimi Code discovers `.kimi-code/AGENTS.md` at project scope and
 * `~/.kimi-code/AGENTS.md` at user scope. Rulesync's topic rules have no
 * dedicated Kimi rule directory, so the processor folds them into this root
 * instruction file.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/agents.html
 */
export class KimiCodeRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: KimiCodeRuleParams) {
    super({
      ...rest,
      fileContent,
      root: root ?? false,
    });
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean; excludeToolDir?: boolean } = {}): KimiCodeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: getKimiCodeRelativeDirPath({ global }),
        relativeFilePath: KIMI_CODE_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<KimiCodeRule> {
    const { root } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, root.relativeDirPath, root.relativeFilePath),
    );

    return new KimiCodeRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent,
      validate,
      global,
      root: true,
    });
  }

  static fromRulesyncRule({
    outputRoot = process.cwd(),
    rulesyncRule,
    validate = true,
    global = false,
  }: ToolRuleFromRulesyncRuleParams): KimiCodeRule {
    const { root } = this.getSettablePaths({ global });
    return new KimiCodeRule({
      outputRoot,
      relativeDirPath: root.relativeDirPath,
      relativeFilePath: root.relativeFilePath,
      fileContent: rulesyncRule.getBody(),
      validate,
      global,
      root: rulesyncRule.getFrontmatter().root ?? false,
    });
  }

  toRulesyncRule(): RulesyncRule {
    return new RulesyncRule({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RULES_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_OVERVIEW_FILE_NAME,
      frontmatter: {
        root: true,
        targets: ["*"],
        globs: ["**/*"],
      },
      body: this.getFileContent(),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): KimiCodeRule {
    return new KimiCodeRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
      root:
        relativeDirPath === getKimiCodeRelativeDirPath({ global }) &&
        relativeFilePath === KIMI_CODE_RULE_FILE_NAME,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kimi-code",
    });
  }
}
