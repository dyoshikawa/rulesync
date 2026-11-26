import { JCODE_DIR, JCODE_RULE_FILE_NAME } from "../../constants/jcode-paths.js";
import { SingleRootFileRule } from "./single-root-file-rule.js";
import { ToolRuleRootOnlySettablePaths } from "./tool-rule.js";

/**
 * Rule generator for jcode.
 *
 * jcode appends the prompt overlay files `./.jcode/prompt-overlay.md`
 * (project) and `~/.jcode/prompt-overlay.md` (global) to its system prompt,
 * after `AGENTS.md`. rulesync writes the root rule there as plain Markdown;
 * jcode has no rules directory, so non-root rules are folded into the same
 * file by the RulesProcessor. The base-prompt replacement `system-prompt.md`
 * is not written: it replaces jcode's built-in prompt, which is too
 * destructive for a rules target.
 *
 * @see https://github.com/1jehuang/jcode/blob/master/docs/SYSTEM_PROMPT_CONFIG.md
 */
export class JcodeRule extends SingleRootFileRule {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolRuleRootOnlySettablePaths {
    // The same relative path in both scopes; the processor supplies the home
    // directory as outputRoot in global mode.
    return { root: { relativeDirPath: JCODE_DIR, relativeFilePath: JCODE_RULE_FILE_NAME } };
  }

  protected static override readonly toolTarget = "jcode";
}
