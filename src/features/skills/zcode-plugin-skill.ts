import { ZCODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";
import { ZcodeSkill } from "./zcode-skill.js";

/**
 * Skill inside a ZCode plugin bundle (`<plugin>/skills/<name>/SKILL.md`).
 *
 * @see https://zcode.z.ai/en/docs/plugin
 */
export class ZcodePluginSkill extends ZcodeSkill {
  protected static override readonly toolTarget = "zcode-plugin";

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: ZCODE_PLUGIN_SKILLS_DIR };
  }
}
