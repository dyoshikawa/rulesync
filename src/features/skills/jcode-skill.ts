import { JCODE_SKILLS_DIR_PATH } from "../../constants/jcode-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * jcode skills follow the Agent Skills layout (`<name>/SKILL.md` with `name`,
 * `description` and optional `allowed-tools` frontmatter, plus supporting
 * files), so this target reuses {@link AgentsSkillsSkill} with jcode's
 * locations: `.jcode/skills/` (project) and `~/.jcode/skills/` (global). In a
 * project, `.jcode/skills/` wins over `.agents/skills/` and `.claude/skills/`.
 *
 * @see https://github.com/1jehuang/jcode/blob/master/crates/jcode-app-core/src/tool/skill.rs
 */
export class JcodeSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: JCODE_SKILLS_DIR_PATH };
  }

  protected static override readonly toolTarget = "jcode";
}
