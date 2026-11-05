import { KiroSkill } from "./kiro-skill.js";

/**
 * Skill generator for the **Kiro CLI**. Kiro IDE and CLI share the same skills
 * format, so this reuses {@link KiroSkill} and only narrows targeting to
 * `kiro-cli`.
 */
export class KiroCliSkill extends KiroSkill {
  protected static override readonly toolTarget = "kiro-cli";
}
