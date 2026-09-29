import { AUGMENTCODE_PLUGIN_RULES_DIR } from "../../constants/plugin-paths.js";
import { AugmentcodeRule, type AugmentcodeRuleSettablePaths } from "./augmentcode-rule.js";
import type { RulesyncRule } from "./rulesync-rule.js";

/**
 * Rule inside an Auggie plugin bundle (`<plugin>/rules/<name>.md`). Auggie
 * parses plugin rules with the same reader as `.augment/rules/`, so the typed
 * `type` / `description` frontmatter carries over unchanged.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginRule extends AugmentcodeRule {
  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "augmentcode-plugin",
    });
  }

  static override getSettablePaths(): AugmentcodeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: AUGMENTCODE_PLUGIN_RULES_DIR,
      },
    };
  }
}
