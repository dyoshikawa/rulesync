import { ZCODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";
import { ZcodeSkill } from "./zcode-skill.js";

/**
 * Skill inside a ZCode plugin bundle (`<plugin>/skills/<name>/SKILL.md`).
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginSkill extends ZcodeSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("zcode-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: ZCODE_PLUGIN_SKILLS_DIR };
  }
}
