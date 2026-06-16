import { KiroSkill } from "./kiro-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

/**
 * Skill generator for the **Kiro CLI**. Kiro IDE and CLI share the same skills
 * format, so this reuses {@link KiroSkill} and only narrows targeting to
 * `kiro-cli`.
 */
export class KiroCliSkill extends KiroSkill {
  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kiro-cli");
  }
}
