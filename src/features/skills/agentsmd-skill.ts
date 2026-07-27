import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import { AgentsSkillsSkill, toSpecConformantAgentSkillFields } from "./agentsskills-skill.js";
import { RulesyncSkill } from "./rulesync-skill.js";
import { SimulatedSkill } from "./simulated-skill.js";
import {
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Represents a simulated skill for AGENTS.md.
 * Since AGENTS.md doesn't have native skill support, this provides
 * a compatible skill directory format at .agents/skills/.
 *
 * `.agents/skills/` is not an AGENTS.md convention — the standard defines only
 * `AGENTS.md` itself. It is the Agent Skills standard's project location, which
 * the native `agentsskills` target writes to as well, so both targets resolve to
 * the same file. To keep that harmless, this writer emits exactly the frontmatter
 * `AgentsSkillsSkill` emits: whichever target runs last, the file on disk is the
 * same, and the standard's optional fields are not dropped.
 *
 * @see https://agents.md/
 * @see https://agentskills.io/specification
 */
export class AgentsmdSkill extends SimulatedSkill {
  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("AgentsmdSkill does not support global mode.");
    }
    return {
      relativeDirPath: AGENTSMD_SKILLS_DIR_PATH,
    };
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AgentsmdSkill> {
    const baseParams = await this.fromDirDefault(params);
    return new AgentsmdSkill(baseParams);
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): AgentsmdSkill {
    const defaults = this.fromRulesyncSkillDefault(params);
    const relativeDirPath = this.getSettablePaths().relativeDirPath;
    const frontmatter = {
      ...defaults.frontmatter,
      // Same shared block, same normalization as the native target that owns
      // this path, so the two writers cannot disagree about the file.
      ...toSpecConformantAgentSkillFields(params.rulesyncSkill.getFrontmatter().agentsskills),
    };

    // Same file, same diagnostics: generating for this target alone must report
    // the spec violations the native target would have reported.
    AgentsSkillsSkill.reportSpecViolations({
      outputRoot: params.outputRoot ?? process.cwd(),
      relativeDirPath,
      dirName: params.rulesyncSkill.getDirName(),
      frontmatter,
      sourceAllowedTools: params.rulesyncSkill.getFrontmatter().agentsskills?.["allowed-tools"],
      logger: params.logger,
    });

    return new AgentsmdSkill({ ...defaults, relativeDirPath, frontmatter });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    return this.isTargetedByRulesyncSkillDefault({
      rulesyncSkill,
      toolTarget: "agentsmd",
    });
  }

  static forDeletion(params: ToolSkillForDeletionParams): AgentsmdSkill {
    const baseParams = this.forDeletionDefault(params);
    return new AgentsmdSkill(baseParams);
  }
}
