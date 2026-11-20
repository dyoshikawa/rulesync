import { AUGMENTCODE_PLUGIN_RULES_DIR } from "../../constants/plugin-paths.js";
import { AugmentcodeRule, type AugmentcodeRuleSettablePaths } from "./augmentcode-rule.js";
import type { ToolRule } from "./tool-rule.js";

/**
 * Rule inside an Auggie plugin bundle (`<plugin>/rules/<name>.md`). Auggie
 * parses plugin rules with the same reader as `.augment/rules/`, so the typed
 * `type` / `description` frontmatter carries over unchanged.
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginRule extends AugmentcodeRule {
  protected static override readonly toolTarget = "augmentcode-plugin";

  static override getSettablePaths(): AugmentcodeRuleSettablePaths {
    return {
      nonRoot: {
        relativeDirPath: AUGMENTCODE_PLUGIN_RULES_DIR,
      },
    };
  }

  /**
   * Auggie 1.x (the stable line on npm `latest` since 1.2.0; 0.x is kept only
   * on the `v0-release` tag with auto-update turned off) no longer loads
   * `rules/` from plugins: "Rules shipped in plugins (`rules/` in a plugin)" is
   * listed among the removed features, while commands, agents, skills, hooks
   * and MCP servers still load. The rule files are still written for users
   * pinned to 0.x, which reads them, but under 1.x the bundle silently loses
   * them, so say so.
   * @see https://docs.augmentcode.com/cli/whats-new
   * @see https://www.augmentcode.com/changelog
   * @see https://docs.augmentcode.com/cli/v0/plugins
   */
  static async getGenerationWarnings({ toolRules }: { toolRules: ToolRule[] }): Promise<string[]> {
    if (toolRules.length === 0) {
      return [];
    }
    return [
      `augmentcode-plugin: plugin rules (rules/*.md) are loaded by Auggie 0.x only; Auggie 1.x no longer reads rules/ from plugins, so these ${toolRules.length} rule file(s) reach only users pinned to Auggie 0.x (1.x is the stable CLI since 1.2.0). Ship instructions that must reach Auggie 1.x users as a skill, or have them generate the augmentcode target in their project.`,
    ];
  }
}
