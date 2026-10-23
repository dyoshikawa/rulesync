import { OPENCODEV1_LAYOUT } from "../../constants/opencode-paths.js";
import { OpenCodeSkill } from "./opencode-skill.js";

/**
 * Skill generator for **OpenCode V1** (OpenCode 1.x). Skills live in the same
 * `skills/<name>/SKILL.md` directories in both generations, so this target
 * reuses {@link OpenCodeSkill} with the V1 layout.
 *
 * @see https://opencode.ai/docs/skills/
 */
export class Opencodev1Skill extends OpenCodeSkill {
  protected static override readonly layout = OPENCODEV1_LAYOUT;
}
