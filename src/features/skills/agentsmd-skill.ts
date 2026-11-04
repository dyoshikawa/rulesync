import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import {
  AgentsSkillsSkill,
  resolveAgentsSkillsSection,
  toAgentsSkillsInvocationField,
  toSpecConformantAgentSkillFields,
} from "./agentsskills-skill.js";
import {
  SimulatedSkill,
  SimulatedSkillFrontmatter,
  SimulatedSkillFrontmatterSchema,
} from "./simulated-skill.js";
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
    // The schema is checked while loading so an invalid SKILL.md fails before
    // the empty-description warning is printed.
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: (options) => this.getSettablePaths(options),
      frontmatterSchema: SimulatedSkillFrontmatterSchema,
    });

    return new AgentsmdSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: this.parseLoadedFrontmatter({ schema: SimulatedSkillFrontmatterSchema, loaded }),
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
    });
  }

  static fromRulesyncSkill(params: ToolSkillFromRulesyncSkillParams): AgentsmdSkill {
    const { outputRoot = process.cwd(), rulesyncSkill, validate = true } = params;
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const relativeDirPath = this.getSettablePaths().relativeDirPath;
    const frontmatter: SimulatedSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      // Same shared block, same normalization as the native target that owns
      // this path, so the two writers cannot disagree about the file.
      ...toSpecConformantAgentSkillFields(resolveAgentsSkillsSection(rulesyncFrontmatter)),
      ...toAgentsSkillsInvocationField(rulesyncFrontmatter.agentsskills),
    };

    // Same file, same diagnostics: generating for this target alone must report
    // the spec violations the native target would have reported.
    AgentsSkillsSkill.reportSpecViolations({
      outputRoot,
      relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter,
      sourceAllowedTools: rulesyncFrontmatter.agentsskills?.["allowed-tools"],
      logger: params.logger,
    });

    return new AgentsmdSkill({
      outputRoot,
      relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
    });
  }

  protected static override readonly toolTarget = "agentsmd";

  static forDeletion(params: ToolSkillForDeletionParams): AgentsmdSkill {
    return new AgentsmdSkill(this.forDeletionParams(params));
  }
}
