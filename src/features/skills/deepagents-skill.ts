import { join } from "node:path";

import { z } from "zod/mini";

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

export const DeepagentsSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "allowed-tools": z.optional(z.array(z.string())),
});

export type DeepagentsSkillFrontmatter = z.infer<typeof DeepagentsSkillFrontmatterSchema>;

export type DeepagentsSkillParams = {
  baseDir?: string;
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
    baseDir = process.cwd(),
    relativeDirPath = join(".deepagents", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: DeepagentsSkillParams) {
    super({
      baseDir,
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

  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      throw new Error("DeepagentsSkill does not support global mode.");
    }
    return {
      relativeDirPath: join(".deepagents", "skills"),
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
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
    };

    return new RulesyncSkill({
      baseDir: this.baseDir,
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
    baseDir = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): DeepagentsSkill {
    const settablePaths = DeepagentsSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const deepagentsFrontmatter: DeepagentsSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new DeepagentsSkill({
      baseDir,
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
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new DeepagentsSkill({
      baseDir: loaded.baseDir,
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
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): DeepagentsSkill {
    const settablePaths = DeepagentsSkill.getSettablePaths({ global });
    return new DeepagentsSkill({
      baseDir,
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
