import { RooRule } from "./roo-rule.js";
import { RulesyncRule } from "./rulesync-rule.js";

/**
 * Rule generator for **Zoo Code**, the community continuation of Roo Code
 * (named by the Roo shutdown notice; releases continue Roo's numbering from
 * v3.54.0). Zoo Code still resolves `~/.roo` and the project `.roo/` layout —
 * the `.zoo` renaming is confined to provider/auth code — so this target
 * reuses {@link RooRule}'s behavior verbatim and only narrows the targeting to
 * the `zoocode` tool name.
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code
 * @see https://docs.zoocode.dev
 */
export class ZoocodeRule extends RooRule {
  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    return this.isTargetedByRulesyncRuleDefault({
      rulesyncRule,
      toolTarget: "zoocode",
    });
  }
}
