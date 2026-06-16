import { KiroRule } from "./kiro-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

/**
 * Rule generator for the **Kiro IDE**.
 *
 * Steering files (`.kiro/steering/*.md` with `inclusion` frontmatter) are
 * identical between the Kiro IDE and CLI, so this target reuses
 * {@link KiroRule}'s behavior verbatim and only narrows the targeting to the
 * `kiro-ide` tool name.
 */
export class KiroIdeRule extends KiroRule {
  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kiro-ide",
    });
  }
}
