import { join } from "node:path";

import { GITLABDUO_DIR, GITLABDUO_RULE_FILE_NAME } from "../../constants/gitlabduo-paths.js";
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

export type GitlabduoRuleParams = AiFileParams & {
  root?: boolean;
};

export type GitlabduoRuleSettablePaths = Pick<ToolRuleSettablePaths, "root"> & {
  root: {
    relativeDirPath: string;
    relativeFilePath: string;
  };
  nonRoot?: undefined;
};

/**
 * GitLab Duo CLI reads custom rules from a single plain-Markdown file:
 * `.gitlab/duo/chat-rules.md` in the project and `~/.gitlab/duo/chat-rules.md`
 * for the user. There is no rules directory, so rulesync's non-root rules are
 * folded into that one file by the RulesProcessor (`nonRoot` is `undefined`).
 *
 * The CLI also reads `AGENTS.md`, but that file is owned by the `agentsmd`
 * target and is not written here.
 *
 * @see https://docs.gitlab.com/user/duo_agent_platform/customize/custom_rules/
 */
export class GitlabduoRule extends ToolRule {
  constructor({ fileContent, root, ...rest }: GitlabduoRuleParams) {
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
  ): GitlabduoRuleSettablePaths {
    // The same `.gitlab/duo/chat-rules.md` path is used relative to the project
    // root and to the home directory.
    return {
      root: {
        relativeDirPath: GITLABDUO_DIR,
        relativeFilePath: GITLABDUO_RULE_FILE_NAME,
      },
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    // Only the single rules file exists, so the incoming path is ignored.
    relativeFilePath: _relativeFilePath,
    validate = true,
    global = false,
  }: ToolRuleFromFileParams): Promise<GitlabduoRule> {
    const { root } = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, root.relativeDirPath, root.relativeFilePath),
    );

    return new GitlabduoRule({
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
  }: ToolRuleFromRulesyncRuleParams): GitlabduoRule {
    const { root } = this.getSettablePaths({ global });

    // Root and non-root rules both target the single rules file; the
    // RulesProcessor folds the non-root bodies into the root rule.
    return new GitlabduoRule({
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

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolRuleForDeletionParams): GitlabduoRule {
    const { root } = this.getSettablePaths({ global });

    return new GitlabduoRule({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      root: relativeFilePath === root.relativeFilePath && relativeDirPath === root.relativeDirPath,
    });
  }

  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "gitlabduo",
    });
  }
}
