import { CLAUDECODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { ClaudecodeSkill } from "./claudecode-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

export class ClaudecodePluginSkill extends ClaudecodeSkill {
  // Overrides the inherited method rather than setting `toolTarget`, because
  // the parent's `scheduled-task` routing is specific to Claude Code itself.
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "claudecode-plugin",
    });
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: CLAUDECODE_PLUGIN_SKILLS_DIR };
  }
}
