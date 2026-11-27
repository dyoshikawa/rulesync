import { BB_DIR, BB_RULE_FILE_NAME } from "../../constants/bb-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * bb appends instructions from exactly two plain-Markdown files to every
 * provider-backed thread's system prompt: `<workspace>/.bb/AGENTS.md` (project)
 * and `<dataDir>/AGENTS.md` (user, `~/.bb/AGENTS.md` by default). bb does not
 * walk parent directories and has no rules directory, so rulesync's non-root
 * rules are folded into that one file by the RulesProcessor (`nonRoot` is
 * `undefined`).
 *
 * Provider-native files bb also forwards (a repository-root `AGENTS.md`,
 * `CLAUDE.md`, ...) belong to the provider targets and are not written here.
 *
 * @see https://github.com/get-bb/bb/blob/main/docs/configuration.md#agent-instructions
 */
export class BbRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
    } = {},
  ): ToolRuleRootOnlySettablePaths {
    // The same `.bb/AGENTS.md` path is used relative to the project root and to
    // the home directory (bb's default data directory is `~/.bb`).
    return {
      root: {
        relativeDirPath: BB_DIR,
        relativeFilePath: BB_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "bb";
}
