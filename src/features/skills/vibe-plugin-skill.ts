import { VIBE_PLUGIN_SKILLS_DIR } from "../../constants/plugin-paths.js";
import type { RulesyncSkill } from "./rulesync-skill.js";
import type { ToolSkillSettablePaths } from "./tool-skill.js";
import { VibeSkill } from "./vibe-skill.js";

/**
 * Skill inside a Vibe plugin bundle (`<plugin>/skills/<name>/SKILL.md`). Vibe
 * parses plugin skills with the same `SkillMetadata` model as `.vibe/skills/`,
 * so the frontmatter is unchanged. Plugin skills are exposed as
 * `<plugin>:<name>`, so the built-in `vibe` / `skill-creator` names are not
 * reserved here.
 *
 * @see https://github.com/mistralai/mistral-vibe/blob/v2.25.8/vibe/core/plugins/_native.py
 */
export class VibePluginSkill extends VibeSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("vibe-plugin");
  }

  static override getSettablePaths(): ToolSkillSettablePaths {
    return { relativeDirPath: VIBE_PLUGIN_SKILLS_DIR };
  }

  protected static override reservesBuiltinSkillNames(): boolean {
    return false;
  }
}
