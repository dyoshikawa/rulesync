import { MUSECODE_RULE_FILE_NAME } from "../../constants/musecode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * Rule generator for Meta Muse Code.
 *
 * Muse Code loads project instructions from the `AGENTS.md` family: it walks up
 * from the working directory to the `.git` boundary and loads one instruction
 * file per directory level, preferring `AGENTS.md` over `CLAUDE.md` when both
 * exist. rulesync emits the project-root `AGENTS.md` (the same shared root file
 * the agentsmd/codexcli targets write). Muse Code also loads machine-wide user
 * rules; since 1.4.23 its changelog names `~/.claude/CLAUDE.md` as that file
 * (the filename of the alternative under Muse's own config directory is not
 * published). `~/.claude/CLAUDE.md` is exactly what the `claudecode` target
 * writes in global mode, so no global scope is supported here: emitting the
 * same file from two targets would make the result depend on target order.
 * `rulesync generate --targets claudecode --global` feeds Muse Code's user
 * rules instead. (Verified against the official docs:
 * https://dev.meta.ai/docs/muse-code/configuration.md and
 * https://dev.meta.ai/docs/muse-code/changelog)
 *
 * rulesync's topic-based non-root rules have no project subdirectory to map
 * onto, so their bodies are folded into the single root `AGENTS.md` by the
 * RulesProcessor; there is no separate non-root output location (`nonRoot` is
 * `undefined`). This mirrors the codexcli and warp targets.
 */
export class MusecodeRule extends SingleRootFileRule {
  static getSettablePaths(
    _options: {
      global?: boolean;
    } = {},
  ): ToolRuleRootOnlySettablePaths {
    // Project scope only: Muse Code's documented user rules file is the
    // `claudecode` global output (`~/.claude/CLAUDE.md`), so `global` is
    // deliberately ignored (supportsGlobal is false in the processor).
    return {
      root: {
        relativeDirPath: ".",
        relativeFilePath: MUSECODE_RULE_FILE_NAME,
      },
    };
  }

  protected static override readonly toolTarget = "musecode";
}
