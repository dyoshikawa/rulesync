import { BOB_SKILLS_DIR_PATH } from "../../constants/bob-paths.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Represents an IBM Bob skill directory.
 *
 * Bob discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.bob/skills/` (project scope) and `~/.bob/skills/` (user scope);
 * the project copy wins on a name clash. The frontmatter requires `name`
 * (matching the directory name) and `description`; supporting files next to
 * `SKILL.md` are carried along.
 *
 * @see https://bob.ibm.com/docs/ide/features/skills
 */
export class BobSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget = "bob";

  protected static override readonly sectionKey = "bob";

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // Both scopes use the same relative path; the processor supplies the home
    // directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.bob/skills/
    // - Global mode: {getHomeDirectory()}/.bob/skills/
    return {
      relativeDirPath: BOB_SKILLS_DIR_PATH,
    };
  }
}
