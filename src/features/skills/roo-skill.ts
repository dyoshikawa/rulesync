import { ROO_SKILLS_DIR_PATH } from "../../constants/roo-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Represents a Roo Code skill directory.
 * Skills are stored under .roo/skills/ directories with SKILL.md files.
 *
 * Keys beyond name/description — Roo's `modeSlugs` mode targeting, the legacy
 * single `mode`, and anything Roo's frozen final release accepts — round-trip
 * through the `roo` section.
 */
export class RooSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget: ToolTarget = "roo";

  protected static override readonly sectionKey = "roo";

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // Roo Code skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.roo/skills/
    // - Global mode: {getHomeDirectory()}/.roo/skills/
    return {
      relativeDirPath: ROO_SKILLS_DIR_PATH,
    };
  }
}
