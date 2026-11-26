import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * DeepCode skills are folders holding a `SKILL.md` (plus optional scripts or
 * references), so this target reuses {@link AgentsSkillsSkill}. DeepCode's
 * documented locations are the cross-tool `<repo>/.agents/skills/` (project)
 * and `~/.agents/skills/` (user), which are the ones rulesync writes. DeepCode
 * also reads `.deepcode/skills/` and `.claude/skills/`; rulesync leaves those
 * to hand-written skills and the `claudecode` target.
 *
 * @see https://github.com/HKUDS/DeepCode/blob/main/docs/guide/skills-and-memory.md
 */
export class DeepcodeSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: AGENTSMD_SKILLS_DIR_PATH };
  }

  protected static override readonly toolTarget = "deepcode";
}
