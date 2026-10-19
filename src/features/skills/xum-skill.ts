import { XUM_SKILLS_DIR_PATH } from "../../constants/xum-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Xum skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter; the directory name is
 * lowercase letters, digits and single hyphens up to 64 characters, and
 * `name` must match it), so this target reuses {@link AgentsSkillsSkill} with
 * Xum's locations: `.xum/skills/` (project) and `~/.xum/skills/` (user).
 * Within one directory `.xum/skills` wins over `.agents/skills`.
 *
 * @see https://xum.cdr.dev/agents/agent-skills
 */
export class XumSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: XUM_SKILLS_DIR_PATH };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("xum");
  }
}
