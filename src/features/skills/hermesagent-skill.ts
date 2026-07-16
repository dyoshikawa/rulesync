import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { rulesyncCommandSlugExists } from "../commands/command-skill-ownership.js";
import { AgentsSkillsSkill, type AgentsSkillsSkillParams } from "./agentsskills-skill.js";

export class HermesagentSkill extends AgentsSkillsSkill {
  static getSettablePaths() {
    return {
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
    };
  }

  /**
   * Commands are emitted into this same skills tree as `<slug>/SKILL.md`
   * (see `HermesagentCommand`), so a directory matching a current rulesync
   * command slug is owned by the commands feature: it must not be imported
   * as a skill nor deleted as an orphan skill.
   */
  static async isDirOwned({
    dirName,
    inputRoot,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    inputRoot: string;
  }): Promise<boolean> {
    return !(await rulesyncCommandSlugExists({ inputRoot, dirName }));
  }

  constructor(params: AgentsSkillsSkillParams) {
    super({
      ...params,
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
    });
  }
}
