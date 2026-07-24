import { ANTIGRAVITY_PLUGIN_RULES_DIR } from "../../constants/plugin-paths.js";
import {
  AntigravityIdeRule,
  type AntigravityIdeRuleSettablePaths,
} from "./antigravity-ide-rule.js";
import type { RulesyncRule } from "./rulesync-rule.js";

export class AntigravityPluginRule extends AntigravityIdeRule {
  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    const targets = rulesyncRule.getFrontmatter().targets;
    return super.isTargetedByRulesyncRule(rulesyncRule) || targets.includes("antigravity-plugin");
  }

  static override getSettablePaths(): AntigravityIdeRuleSettablePaths {
    return {
      root: {
        relativeDirPath: ANTIGRAVITY_PLUGIN_RULES_DIR,
        relativeFilePath: "AGENTS.md",
      },
      nonRoot: {
        relativeDirPath: ANTIGRAVITY_PLUGIN_RULES_DIR,
      },
    };
  }
}
