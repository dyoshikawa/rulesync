import { THEIA_RULE_FILE_NAME } from "../../constants/theia-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Eclipse Theia AI.
 *
 * Theia AI reads the workspace-root `AGENTS.md` only (`CLAUDE.md`, `AGENT.md`
 * and nested files are deliberately not fallbacks). The RulesProcessor folds
 * non-root rules into that file (`nonRoot` is `undefined`, mirroring the
 * cortexcode and codexcli targets). No user-scoped rule file is documented,
 * so global rules are unsupported.
 *
 * @see https://theia-ide.org/docs/user_ai/
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/agents-md.ts
 */
export class TheiaRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
    } = {},
  ): ToolRuleRootOnlySettablePaths {
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: THEIA_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "theia";
}
