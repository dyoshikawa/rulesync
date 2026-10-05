import { KIMI_CODE_PLUGIN_SYSTEM_PROMPT_FILE_NAME } from "../../constants/plugin-paths.js";
import { KimiCodeRule, type KimiCodeRuleSettablePaths } from "./kimi-code-rule.js";
import type { RulesyncRule } from "./rulesync-rule.js";

/**
 * Instructions inside a Kimi Code plugin bundle (`<plugin>/SYSTEM.md`), the
 * file a `systemPromptPath: "./SYSTEM.md"` manifest entry points to. Kimi
 * appends it to the agent's system prompt while the plugin is enabled, unlike
 * `$KIMI_CODE_HOME/SYSTEM.md`, which replaces the prompt. A plugin has a single
 * instructions file, so topic rules are folded into it, and Kimi ignores the
 * file when it exceeds 32 KB.
 *
 * @see https://github.com/MoonshotAI/kimi-code/blob/%40moonshot-ai/kimi-code%402.1.1/docs/en/customization/plugins.md
 */
export class KimiCodePluginRule extends KimiCodeRule {
  static override getSettablePaths(): KimiCodeRuleSettablePaths {
    return {
      root: { relativeDirPath: ".", relativeFilePath: KIMI_CODE_PLUGIN_SYSTEM_PROMPT_FILE_NAME },
    };
  }

  /**
   * A `localRoot` rule holds personal instructions; appending it to the shipped
   * `SYSTEM.md` would distribute it with the bundle, so it is never written.
   */
  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    if (rulesyncRule.getFrontmatter().localRoot) {
      return false;
    }
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kimi-code-plugin",
    });
  }

  /**
   * The bundle is read from `--output-root <plugin>`, but the imported rulesync
   * file belongs to the project's `.rulesync/`, not to the plugin root.
   */
  protected override getRulesyncOutputRoot(): string {
    return ".";
  }
}
