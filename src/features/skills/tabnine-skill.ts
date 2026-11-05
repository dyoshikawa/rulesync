import { TABNINE_SKILLS_DIR_PATH } from "../../constants/tabnine-paths.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Represents a Tabnine CLI skill directory.
 *
 * Tabnine CLI discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.tabnine/agent/skills/` (workspace scope) and
 * `~/.tabnine/agent/skills/` (user scope); the workspace copy wins on a name
 * clash. The frontmatter requires `name` (matching the directory name) and
 * `description`; supporting files next to `SKILL.md` are carried along.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/agent-skills
 */
export class TabnineSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget = "tabnine";

  protected static override readonly sectionKey = "tabnine";

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // Both scopes use the same relative path; the processor supplies the home
    // directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.tabnine/agent/skills/
    // - Global mode: {getHomeDirectory()}/.tabnine/agent/skills/
    return {
      relativeDirPath: TABNINE_SKILLS_DIR_PATH,
    };
  }
}
