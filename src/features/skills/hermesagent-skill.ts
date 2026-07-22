import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { AgentsSkillsSkill, type AgentsSkillsSkillParams } from "./agentsskills-skill.js";

export class HermesagentSkill extends AgentsSkillsSkill {
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
