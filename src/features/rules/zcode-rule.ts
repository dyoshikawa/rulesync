import { ZCODE_DIR, ZCODE_RULE_FILE_NAME } from "../../constants/zcode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

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

export class ZcodeRule extends SingleRootFileRule {
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

  protected static override isRootFilePath({
    relativeDirPath,
    relativeFilePath,
  }: {
    relativeDirPath: string;
    relativeFilePath: string;
    global: boolean;
  }): boolean {
    return (
      relativeFilePath === ZCODE_RULE_FILE_NAME &&
      (relativeDirPath === "." || relativeDirPath === ZCODE_DIR)
    );
  }

  protected static override readonly toolTarget = "zcode";
}
