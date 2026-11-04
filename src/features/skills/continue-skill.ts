import { CONTINUE_SKILLS_DIR_PATH } from "../../constants/continue-paths.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

// Continue skill frontmatter: `name` and `description` are required as in the
// Agent Skills spec (Continue additionally rejects empty strings at load
// time); Continue validates nothing else.
// @see https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/util/loadMarkdownSkills.ts

/**
 * Represents a Continue skill directory.
 *
 * Continue discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.continue/skills/` (project scope) and `~/.continue/skills/`
 * (user scope); it also reads `.claude/skills/`, which the claudecode target
 * covers. The frontmatter requires `name` (matching the directory name) and
 * `description`; supporting files next to `SKILL.md` are carried along.
 *
 * @see https://github.com/continuedev/continue/blob/5522c6f44ca0ac3528b37244818fbfa39b5af470/extensions/cli/src/util/loadMarkdownSkills.ts
 */
export class ContinueSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget = "continue";

  protected static override readonly sectionKey = "continue";

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // The processor supplies the home directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.continue/skills/
    // - Global mode: {getHomeDirectory()}/.continue/skills/
    return {
      relativeDirPath: CONTINUE_SKILLS_DIR_PATH,
    };
  }
}
