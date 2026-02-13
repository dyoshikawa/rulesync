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

export const OpenCodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "allowed-tools": z.optional(z.array(z.string())),
});

export type OpenCodeSkillFrontmatter = z.infer<typeof OpenCodeSkillFrontmatterSchema>;

export type OpenCodeSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: OpenCodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

export class OpenCodeSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".opencode", "skill"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: OpenCodeSkillParams) {
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: global ? join(".config", "opencode", "skill") : join(".opencode", "skill"),
    };
  }

  getFrontmatter(): OpenCodeSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error(`Frontmatter is not defined in ${join(this.relativeDirPath, this.dirName)}`);
    }
    const result = OpenCodeSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (this.mainFile === undefined) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${SKILL_FILE_NAME} file does not exist`),
      };
    }
    const result = OpenCodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
      ...(frontmatter["allowed-tools"] && {
        opencode: {
          "allowed-tools": frontmatter["allowed-tools"],
        },
      }),
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
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): OpenCodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const opencodeFrontmatter: OpenCodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      "allowed-tools": rulesyncFrontmatter.opencode?.["allowed-tools"],
    };

    const settablePaths = OpenCodeSkill.getSettablePaths({ global });

    return new OpenCodeSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: opencodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("opencode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<OpenCodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: OpenCodeSkill.getSettablePaths,
    });

    const result = OpenCodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new OpenCodeSkill({
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
  }: ToolSkillForDeletionParams): OpenCodeSkill {
    return new OpenCodeSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
