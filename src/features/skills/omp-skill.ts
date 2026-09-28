import { OMP_LAYOUT } from "../../constants/omp-paths.js";
import { PiSkill } from "./pi-skill.js";

/**
 * Skill generator for **oh-my-pi** (`omp`), a fork of Pi. oh-my-pi keeps Pi's
 * `SKILL.md` format (`name` and `description` are required by its native
 * provider) and scans `skills/<name>/SKILL.md` under `.omp/` (project) and
 * `~/.omp/agent/` (global), so this target reuses {@link PiSkill} with that
 * layout.
 *
 * @see https://github.com/can1357/oh-my-pi/blob/main/docs/skills.md
 */
export class OmpSkill extends PiSkill {
  protected static override readonly layout = OMP_LAYOUT;
}
