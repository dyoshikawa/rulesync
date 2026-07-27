import { HERMESAGENT_SKILLS_DIR_PATH } from "../../constants/hermesagent-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import {
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
} from "../../utils/hermesagent.js";
import {
  AgentsSkillsSkill,
  type AgentsSkillsSkillParams,
  toAllowedToolsArray,
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}) {
    return {
      relativeDirPath: getHermesagentRelativeDirPath({
        global,
        relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
      }),
    };
  }

  constructor(params: AgentsSkillsSkillParams) {
    super({
      ...params,
      relativeDirPath: HermesagentSkill.getSettablePaths({ global: params.global }).relativeDirPath,
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
    // must not produce two different on-disk spellings. `metadata` is exempt
    // because Hermes reads structured values under `metadata.hermes`
    // (`requires_toolsets`, `tags`, …) that string coercion would break.
    const shared = toSpecConformantAgentSkillFields(rulesyncFrontmatter.agentsskills, {
      coerceMetadata: false,
    });
    const hermes = rulesyncFrontmatter.hermesagent ?? {};
    const dirName = rulesyncSkill.getDirName();
    const frontmatter = {
      ...shared,
      ...hermes,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    HermesagentSkill.reportSpecViolations({
      outputRoot,
      relativeDirPath: HERMESAGENT_SKILLS_DIR_PATH,
      dirName,
      frontmatter,
      sourceAllowedTools: rulesyncFrontmatter.agentsskills?.["allowed-tools"],
      logger,
    });

    return new this({
      outputRoot,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      dirName,
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  override toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const allowedTools =
      frontmatter["allowed-tools"] === undefined
        ? undefined
        : toAllowedToolsArray(frontmatter["allowed-tools"]);
    const agentsskills: NonNullable<RulesyncSkillFrontmatterInput["agentsskills"]> = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && {
        compatibility: frontmatter.compatibility,
      }),
      // Normalized back to the canonical rulesync array, matching the base
      // class, so a generate → import round trip leaves the source unchanged.
      ...(allowedTools !== undefined &&
        allowedTools.length > 0 && { "allowed-tools": allowedTools }),
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
      outputRoot: getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
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
      relativeDirPath: relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
