import { GAJAECODE_LAYOUT } from "../../constants/gajaecode-paths.js";
import { PiSkill } from "./pi-skill.js";

/**
 * Skill generator for **Gajae-Code** (`gjc`), a descendant of Pi. Gajae-Code
 * loads `SKILL.md` skills (a non-empty `description` is required) from
 * `.gjc/skills/<name>/` (project) and `~/.gjc/agent/skills/<name>/` (global),
 * so this target reuses {@link PiSkill} with the `.gjc` layout. Claude Code and
 * Codex skill directories are import sources only and are never loaded.
 *
 * @see https://github.com/Yeachan-Heo/gajae-code/blob/main/docs/skills.md
 */
export class GajaecodeSkill extends PiSkill {
  protected static override readonly layout = GAJAECODE_LAYOUT;
}
