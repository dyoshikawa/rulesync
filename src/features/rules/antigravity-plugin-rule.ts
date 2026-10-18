import { ANTIGRAVITY_PLUGIN_RULES_DIR } from "../../constants/plugin-paths.js";
import {
  AntigravityIdeRule,
  type AntigravityIdeRuleSettablePaths,
} from "./antigravity-ide-rule.js";
import type { AntigravityRuleFrontmatter } from "./antigravity-rule.js";
import type { RulesyncRule } from "./rulesync-rule.js";

export class AntigravityPluginRule extends AntigravityIdeRule {
  // A plugin bundles its rules in its own `rules/` directory, outside any
  // project tree, so a subproject-scoped rule is not nested here.
  protected static override supportsSubprojectRules(): boolean {
    return false;
  }

  // The root rule lives at `rules/AGENTS.md`, and every `.md` in a plugin's
  // `rules/` needs a valid `trigger` (`agy plugin validate` errors without one
  // since CLI 1.4.1), so it is written as an always-on rule.
  // @see https://antigravity.google/docs/rules
  // @see https://github.com/google-antigravity/antigravity-cli/releases/tag/1.4.1
  protected static override getRootRuleFrontmatter(): AntigravityRuleFrontmatter {
    return { trigger: "always_on" };
  }

  static override isTargetedByRulesyncRule(rulesyncRule: RulesyncRule): boolean {
    const targets = rulesyncRule.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("antigravity-plugin");
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
