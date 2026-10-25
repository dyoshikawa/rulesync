import { MUSECODE_RULE_FILE_NAME } from "../../constants/musecode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleSettablePaths } from "./tool-rule.js";

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

export class MusecodeRule extends SingleRootFileRule {
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

  protected static override readonly toolTarget = "musecode";
}
