import { BB_SKILLS_DIR_PATH } from "../../constants/bb-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * bb skills follow the Agent Skills layout (`<name>/SKILL.md` with `name` and
 * `description` frontmatter, where `name` is lowercase, hyphenated and matches
 * the directory), so this target reuses {@link AgentsSkillsSkill} with bb's own
 * locations: `.bb/skills/` (project) and `<dataDir>/skills/` (global,
 * `~/.bb/skills/` by default). bb injects these skills into every provider; a
 * project skill overrides a user skill of the same name.
 *
 * @see https://github.com/get-bb/bb/blob/main/docs/configuration.md#skills
 */
export class BbSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return { relativeDirPath: BB_SKILLS_DIR_PATH };
  }

  protected static override readonly toolTarget = "bb";
}
