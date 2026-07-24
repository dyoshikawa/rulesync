import { CLAUDECODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

export class ClaudecodePluginSkill extends ClaudecodeSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return super.isTargetedByRulesyncSkill(rulesyncSkill) || targets.includes("claudecode-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: CLAUDECODE_PLUGIN_SKILLS_DIR };
  }
}
