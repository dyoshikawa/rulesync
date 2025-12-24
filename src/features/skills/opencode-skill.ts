import { join } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
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

export const OpencodeSkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
});

export type OpencodeSkillFrontmatter = z.infer<typeof OpencodeSkillFrontmatterSchema>;

export type OpencodeSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: OpencodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents an OpenCode skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 * Extends ToolSkill to inherit directory management and security features from AiDir.
 *
 * OpenCode skills are stored in:
 * - Project mode: .opencode/skill/{skill-name}/SKILL.md
 * - Global mode: ~/.opencode/skill/{skill-name}/SKILL.md
 */
export class OpencodeSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".opencode", "skill"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: OpencodeSkillParams) {
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

  static getSettablePaths({
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // OpenCode skills use the same relative path for both project and global modes
    // The actual location differs based on baseDir:
    // - Project mode: {process.cwd()}/.opencode/skill/
    // - Global mode: {getHomeDirectory()}/.opencode/skill/
    return {
      relativeDirPath: join(".opencode", "skill"),
    };
  }

  getFrontmatter(): OpencodeSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = OpencodeSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
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
    const result = OpencodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
      relativeDirPath: this.relativeDirPath,
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
  }: ToolSkillFromRulesyncSkillParams): OpencodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const opencodeFrontmatter: OpencodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    const settablePaths = OpencodeSkill.getSettablePaths({ global });

    return new OpencodeSkill({
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

  static isTargetedByRulesyncSkill(_rulesyncSkill: RulesyncSkill): boolean {
    // Skills don't have targets field like commands/subagents do
    // All skills are available to OpenCode
    return true;
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<OpencodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: OpencodeSkill.getSettablePaths,
    });

    const result = OpencodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new OpencodeSkill({
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
  }: ToolSkillForDeletionParams): OpencodeSkill {
    return new OpencodeSkill({
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
