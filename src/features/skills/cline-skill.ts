import { CLINE_SKILLS_DIR_PATH } from "../../constants/cline-paths.js";
import { SectionPassthroughSkill } from "./section-passthrough-skill.js";
import { ToolSkillSettablePaths } from "./tool-skill.js";

/**
 * Represents a Cline Code skill directory.
 * Skills are stored under .cline/skills/ directories with SKILL.md files.
 * Cline also scans roots owned by other targets; a same-name skill in a later
 * root (`.claude/skills/`, `.agents/skills/`, user scope) wins in Cline.
 *
 * Keys beyond name/description — most usefully the `disabled: true` (or
 * `enabled: false`) toggle Cline writes into SKILL.md when a skill is switched
 * off in its UI — round-trip through the `cline` section.
 */
export class ClineSkill extends SectionPassthroughSkill {
  protected static override readonly toolTarget = "cline";

  protected static override readonly sectionKey = "cline";

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Cline Code skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.cline/skills/
    // - Global mode: {getHomeDirectory()}/.cline/skills/
    return {
      relativeDirPath: CLINE_SKILLS_DIR_PATH,
    };
  }
}
