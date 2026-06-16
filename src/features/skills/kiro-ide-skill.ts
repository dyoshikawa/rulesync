import { KiroSkill } from "./kiro-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

/**
 * Skill generator for the **Kiro IDE**. Kiro IDE and CLI share the same skills
 * format, so this reuses {@link KiroSkill} and only narrows targeting to
 * `kiro-ide`.
 */
export class KiroIdeSkill extends KiroSkill {
  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kiro-ide");
  }
}
