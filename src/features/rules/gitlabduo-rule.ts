import { GITLABDUO_DIR, GITLABDUO_RULE_FILE_NAME } from "../../constants/gitlabduo-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

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
export class GitlabduoRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
    } = {},
  ): ToolRuleRootOnlySettablePaths {
    // The same `.gitlab/duo/chat-rules.md` path is used relative to the project
    // root and to the home directory.
    return {
      root: {
        relativeDirPath: GITLABDUO_DIR,
        relativeFilePath: GITLABDUO_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "gitlabduo";
}
