import { KiroSkill } from "./kiro-skill.js";

/**
 * Skill generator for the **Kiro IDE**. Kiro IDE and CLI share the same skills
 * format, so this reuses {@link KiroSkill} and only narrows targeting to
 * `kiro-ide`.
 */
export class KiroIdeSkill extends KiroSkill {
  protected static override readonly toolTarget = "kiro-ide";
}
