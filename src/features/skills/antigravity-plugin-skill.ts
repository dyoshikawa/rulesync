import { ANTIGRAVITY_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { AntigravityIdeSkill } from "./antigravity-ide-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

export class AntigravityPluginSkill extends AntigravityIdeSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("antigravity-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: ANTIGRAVITY_PLUGIN_SKILLS_DIR };
  }
}
