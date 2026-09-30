import { QODER_SKILLS_DIR_PATH } from "../../constants/qoder-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Qoder skills follow the Agent Skills layout (`<name>/SKILL.md` with the
 * required `name` and `description` frontmatter; `name` is lowercase letters,
 * digits and hyphens up to 64 characters, `description` up to 1024), so this
 * target reuses {@link AgentsSkillsSkill} with Qoder's locations:
 * `.qoder/skills/` (project) and `~/.qoder/skills/` (user). The Qoder IDE and
 * the CLI read the same directories.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/Skills
 */
export class QoderSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: QODER_SKILLS_DIR_PATH };
  }

  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("qoder");
  }
}
