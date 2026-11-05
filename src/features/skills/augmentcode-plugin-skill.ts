import { AUGMENTCODE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import { AugmentcodeSkill } from "./augmentcode-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Skill inside an Auggie plugin bundle (`<plugin>/skills/<name>/SKILL.md`).
 *
 * @see https://docs.augmentcode.com/cli/plugins
 */
export class AugmentcodePluginSkill extends AugmentcodeSkill {
  protected static override readonly toolTarget = "augmentcode-plugin";

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: AUGMENTCODE_PLUGIN_SKILLS_DIR };
  }
}
