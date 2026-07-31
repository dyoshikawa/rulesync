import { RooSkill } from "./roo-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

/**
 * Skill generator for **Zoo Code** (the community continuation of Roo Code).
 * Zoo Code keeps Roo's skills layout (`.roo/skills/` project,
 * `~/.roo/skills/` global) and the `roo:` frontmatter section (`modeSlugs`),
 * so this target reuses {@link RooSkill} verbatim and only narrows the
 * targeting.
 *
 * @see https://docs.zoocode.dev/features/skills
 */
export class ZoocodeSkill extends RooSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("zoocode");
  }
}
