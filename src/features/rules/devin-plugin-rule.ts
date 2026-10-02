import { DEVIN_PLUGIN_RULES_DIR } from "../../constants/plugin-paths.js";
import { DevinRule, type DevinRuleSettablePaths } from "./devin-rule.js";
import type { RulesyncRule } from "./rulesync-rule.js";

/**
 * Rules inside a Devin plugin bundle. The root rule is the always-on
 * `<plugin>/AGENTS.md` (plain Markdown, as in a project), and non-root rules
 * are `<plugin>/rules/<name>.md` with the same `trigger` frontmatter as
 * `.devin/rules/`.
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 */
export class DevinPluginRule extends DevinRule {
  protected static override getNonRootDirPath(): string {
    return DEVIN_PLUGIN_RULES_DIR;
  }

  static override getSettablePaths(): DevinRuleSettablePaths {
    return {
      root: { relativeDirPath: ".", relativeFilePath: "AGENTS.md" },
      nonRoot: { relativeDirPath: DEVIN_PLUGIN_RULES_DIR },
    };
  }

  /**
   * A `localRoot` rule holds personal instructions; Devin documents no local
   * overlay for plugins, and appending it to the shipped `AGENTS.md` would
   * distribute it with the bundle, so it is never written.
   */
  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    if (rulesyncRule.getFrontmatter().localRoot) {
      return false;
    }
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "devin-plugin",
    });
  }
}
