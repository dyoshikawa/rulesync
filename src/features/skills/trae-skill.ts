import { TRAE_SKILLS_DIR_PATH } from "../../constants/trae-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Trae skills follow the Agent Skills standard (a `SKILL.md` with `name` and
 * `description` frontmatter, plus optional supporting files), so this target
 * reuses {@link AgentsSkillsSkill} with Trae's locations: `.trae/skills/` in the
 * project and `~/.trae/skills/` for the user.
 *
 * @see https://docs.trae.ai/ide/skills?_lang=en
 */
export class TraeSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return { relativeDirPath: TRAE_SKILLS_DIR_PATH };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("trae");
  }
}
