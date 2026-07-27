import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  AgentsSkillsSkill,
  type AgentsSkillsSkillParams,
  toSpecConformantAgentSkillFields,
} from "./agentsskills-skill.js";
import { RulesyncSkill, type RulesyncSkillFrontmatterInput } from "./rulesync-skill.js";
import type {
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
} from "./tool-skill.js";

const SHARED_AGENT_SKILL_FIELDS = new Set(["license", "compatibility", "allowed-tools"]);

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

  static override fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
    logger,
  }: ToolSkillFromRulesyncSkillParams): HermesagentSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    // The `agentsskills` block is the same rulesync source the native Agent
    // Skills target reads, so it goes through the same normalization: one input
    // must not produce two different on-disk spellings.
    const shared = toSpecConformantAgentSkillFields(rulesyncFrontmatter.agentsskills);
    const hermes = rulesyncFrontmatter.hermesagent ?? {};

    HermesagentSkill.reportSpecViolations({
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
      dirName: rulesyncSkill.getDirName(),
      rulesyncFrontmatter,
      logger,
    });

    return new this({
      outputRoot,
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: {
        ...shared,
        ...hermes,
        name: rulesyncFrontmatter.name,
        description: rulesyncFrontmatter.description,
      },
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  override toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const agentsskills: NonNullable<RulesyncSkillFrontmatterInput["agentsskills"]> = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && {
        compatibility: frontmatter.compatibility,
      }),
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
    };
    const hermesagent: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(frontmatter)) {
      if (key === "name" || key === "description") {
        continue;
      }
      if (!SHARED_AGENT_SKILL_FIELDS.has(key)) {
        hermesagent[key] = value;
      }
    }

    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(agentsskills).length > 0 && { agentsskills }),
      ...(Object.keys(hermesagent).length > 0 && { hermesagent }),
    };
    return new RulesyncSkill({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static override async fromDir(params: ToolSkillFromDirParams): Promise<HermesagentSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: HermesagentSkill.getSettablePaths,
    });
    return new this({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: loaded.frontmatter as AgentsSkillsSkillParams["frontmatter"],
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  static override forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): HermesagentSkill {
    return new this({
      outputRoot,
      relativeDirPath: relativeDirPath ?? HERMESAGENT_SKILLS_DIR_PATH,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
