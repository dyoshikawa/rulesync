import { KiroRule } from "./kiro-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

/**
 * Rule generator for the **Kiro CLI**.
 *
 * Kiro IDE and Kiro CLI share the same `.kiro/steering/*.md` steering format, so
 * this target reuses {@link KiroRule}'s behavior verbatim and only narrows the
 * targeting to the `kiro-cli` tool name.
 */
export class KiroCliRule extends KiroRule {
  static isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "kiro-cli",
    });
  }
}
