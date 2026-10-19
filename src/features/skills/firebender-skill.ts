import { FIREBENDER_SKILLS_DIR_PATH } from "../../constants/firebender-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Firebender skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter, plus optional supporting
 * files), so this target reuses {@link AgentsSkillsSkill} with Firebender's
 * recommended locations: `.firebender/skills/` (project) and
 * `~/.firebender/skills/` (user).
 *
 * @see https://docs.firebender.com/api-reference/skills
 */
export class FirebenderSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: FIREBENDER_SKILLS_DIR_PATH };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("firebender");
  }
}
