import { THEIA_SKILLS_DIR_PATH } from "../../constants/theia-paths.js";
import { AgentsSkillsSkill } from "./agentsskills-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Eclipse Theia AI skills follow the Agent Skills standard (`<name>/SKILL.md`;
 * `name` must be lowercase kebab-case and equal the directory name, and
 * `description` is at most 1024 characters, or Theia skips the skill). Theia
 * reads workspace skills from `.prompts/skills/` and the shared
 * `.agents/skills/` root, and user skills from its product configuration
 * folder (`~/.theia/skills/` for the Theia platform, `~/.theia-ide/skills/`
 * for the Theia IDE, ...) and `~/.agents/skills/`.
 *
 * This target writes the two roots every Theia-based product reads, the shared
 * `.agents/skills/` (project) and `~/.agents/skills/` (global), and reuses
 * {@link AgentsSkillsSkill} unchanged, so the file it writes is byte-for-byte
 * the one the `agentsskills` target (and every other writer of that root
 * built on it) writes — whichever target runs last. The Agent Skills spec
 * checks it inherits cover the rules Theia enforces.
 *
 * @see https://theia-ide.org/docs/user_ai/#agent-skills
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/skill.ts
 */
export class TheiaSkill extends AgentsSkillsSkill {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Both scopes share the same relative path; the home-directory root is
    // applied by the processor in global mode.
    return { relativeDirPath: THEIA_SKILLS_DIR_PATH };
  }

  protected static override readonly toolTarget = "theia";
}
