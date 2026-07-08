import { join } from "node:path";

import { z } from "zod/mini";

import {
  DEEPAGENTS_GLOBAL_SKILLS_DIR_PATH,
  DEEPAGENTS_SKILLS_DIR_PATH,
} from "../../constants/deepagents-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const DeepagentsSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // dcode's `_parse_allowed_tools` only accepts a space-delimited string; a YAML
  // list is rejected at runtime (the allowlist is silently dropped). A list is
  // still accepted here for tolerant parsing of hand-written files, but on emit
  // rulesync always writes the space-delimited string form.
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // Agent Skills spec fields read by dcode's `_parse_skill_metadata`.
  // https://agentskills.io/specification
  license: z.optional(z.string()),
  // The Agent Skills spec defines `compatibility` as a free-form string
  // (1–500 chars), which is what dcode actually reads; an object form is also
  // tolerated for backward compatibility (matches the `agentsskills` adapter).
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type DeepagentsSkillFrontmatter = z.infer<typeof DeepagentsSkillFrontmatterSchema>;

export type DeepagentsSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: DeepagentsSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

export class DeepagentsSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = DEEPAGENTS_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: DeepagentsSkillParams) {
    super({
      outputRoot,
      relativeDirPath,
      dirName,
      mainFile: {
        name: SKILL_FILE_NAME,
        body,
        frontmatter: { ...frontmatter },
      },
      otherFiles,
      global,
    });

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // dcode discovers user-level skills in `~/.deepagents/<agent_name>/skills/`
    // (default agent_name `deepagents`); the home directory is resolved by the
    // processor through outputRoot in global mode.
    return {
      relativeDirPath: global ? DEEPAGENTS_GLOBAL_SKILLS_DIR_PATH : DEEPAGENTS_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): DeepagentsSkillFrontmatter {
    const result = DeepagentsSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (!this.mainFile) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }

    const result = DeepagentsSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const allowedTools = frontmatter["allowed-tools"];
    // Normalize back to the canonical rulesync array representation. dcode
    // serializes `allowed-tools` as a whitespace-delimited string, so split it.
    const allowedToolsArray =
      allowedTools === undefined
        ? undefined
        : Array.isArray(allowedTools)
          ? allowedTools
          : allowedTools.split(/\s+/).filter((tool) => tool.length > 0);
    const deepagentsBlock = {
      ...(allowedToolsArray !== undefined &&
        allowedToolsArray.length > 0 && { "allowed-tools": allowedToolsArray }),
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && { compatibility: frontmatter.compatibility }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(deepagentsBlock).length > 0 && { deepagents: deepagentsBlock }),
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

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): DeepagentsSkill {
    const settablePaths = DeepagentsSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const deepagentsSection = rulesyncFrontmatter.deepagents;
    const allowedTools = deepagentsSection?.["allowed-tools"];
    // dcode only honors a space-delimited string; serialize the canonical array
    // into that form so the allowlist is not dropped at runtime.
    const allowedToolsString = Array.isArray(allowedTools) ? allowedTools.join(" ") : allowedTools;
    const deepagentsFrontmatter: DeepagentsSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(allowedToolsString && { "allowed-tools": allowedToolsString }),
      ...(deepagentsSection?.license !== undefined && { license: deepagentsSection.license }),
      ...(deepagentsSection?.compatibility !== undefined && {
        compatibility: deepagentsSection.compatibility,
      }),
      ...(deepagentsSection?.metadata !== undefined && { metadata: deepagentsSection.metadata }),
    };

    return new DeepagentsSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: deepagentsFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("deepagents");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<DeepagentsSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: DeepagentsSkill.getSettablePaths,
    });

    const result = DeepagentsSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new DeepagentsSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: result.data,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): DeepagentsSkill {
    const settablePaths = DeepagentsSkill.getSettablePaths({ global });
    return new DeepagentsSkill({
      outputRoot,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
