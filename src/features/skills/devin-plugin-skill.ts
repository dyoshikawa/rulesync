import { DEVIN_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { DevinSkill } from "./devin-skill.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Skill inside a Devin plugin bundle (`<plugin>/skills/<name>/SKILL.md`).
 * Plugins introduce no new skill format, so the `.devin/skills/` frontmatter
 * carries over; Devin exposes each one as `/<plugin>:<name>`.
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 */
export class DevinPluginSkill extends DevinSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("devin-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: DEVIN_PLUGIN_SKILLS_DIR };
  }

  /**
   * Unlike `.devin/skills/`, the plugin `skills/` tree is not shared with the
   * commands feature (`devin-plugin` emits no commands), so every directory
   * in it is a skill.
   */
  static override async isDirOwned(): Promise<boolean> {
    return true;
  }
}
