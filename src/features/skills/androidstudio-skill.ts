import { ANDROIDSTUDIO_SKILLS_DIR_PATH } from "../../constants/androidstudio-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Gemini in Android Studio skills follow the Agent Skills open standard
 * (`<name>/SKILL.md` with `name` and `description` frontmatter), so this target
 * reuses {@link AgentsSkillsSkill} with Android Studio's own location:
 * `.android-studio/skills/` at the project root (project) or in the home
 * directory (global). The shared `.agents/skills/` location Android Studio also
 * reads belongs to the `agentsskills` target.
 *
 * @see https://developer.android.com/studio/gemini/skills
 */
export class AndroidstudioSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: ANDROIDSTUDIO_SKILLS_DIR_PATH };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("androidstudio");
  }
}
