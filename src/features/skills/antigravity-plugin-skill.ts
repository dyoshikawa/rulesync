import { ANTIGRAVITY_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { AntigravityIdeSkill } from "./antigravity-ide-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

export class AntigravityPluginSkill extends AntigravityIdeSkill {
  // Overrides the inherited method rather than setting `toolTarget`, because
  // the parent's check is keyed by the `antigravity-ide` section target.
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "antigravity-plugin",
    });
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: ANTIGRAVITY_PLUGIN_SKILLS_DIR };
  }

  /**
   * The plugin `skills/` tree is not shared with the commands feature, so
   * every directory in it is a skill.
   */
  static override async isDirOwned(): Promise<boolean> {
    return true;
  }
}
