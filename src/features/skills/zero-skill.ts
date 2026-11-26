import { ZERO_GLOBAL_SKILLS_DIR_PATH } from "../../constants/zero-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Zero skills follow the Agent Skills layout (`<name>/SKILL.md` with `name`
 * and `description` frontmatter, plus optional bundled files), so this target
 * reuses {@link AgentsSkillsSkill}. Zero has no project skills directory
 * ("standalone project skill directories are not supported"), so the target
 * is global-only: `~/.local/share/zero/skills/` on every platform (Zero's
 * primary skills root when `$ZERO_SKILLS_DIR` and `$XDG_DATA_HOME` are unset).
 * Zero parses the frontmatter line by line, so the skills processor writes
 * every value on one line for this target.
 *
 * @see https://github.com/Twigpine/zero/blob/main/docs/EXTENDING.md#3-skills
 * @see https://github.com/Twigpine/zero/blob/main/internal/skills/skills.go
 */
export class ZeroSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return { relativeDirPath: ZERO_GLOBAL_SKILLS_DIR_PATH };
  }

  protected static override readonly toolTarget = "zero";
}
