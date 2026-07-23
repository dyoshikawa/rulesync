import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { AgentsSkillsSkill, type AgentsSkillsSkillParams } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";

export class HermesagentSkill extends AgentsSkillsSkill {
  static override isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return (
      targets.includes("*") || targets.includes("agentsskills") || targets.includes("hermesagent")
    );
  }

  static getSettablePaths() {
    return {
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
    };
  }

  constructor(params: AgentsSkillsSkillParams) {
    super({
      ...params,
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
    });
  }
}
