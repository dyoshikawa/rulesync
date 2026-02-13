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

export const CursorSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type CursorSkillFrontmatter = z.infer<typeof CursorSkillFrontmatterSchema>;

export type CursorSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CursorSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Cursor skill directory.
 * Skills are stored under the .cursor/skills directory with SKILL.md files.
 */
export class CursorSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".cursor", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CursorSkillParams) {
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

  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    // Cursor skills use the same relative path for both project and global modes
    // The actual location differs based on baseDir:
    // - Project mode: {process.cwd()}/.cursor/skills/
    // - Global mode: {getHomeDirectory()}/.cursor/skills/
    return {
      relativeDirPath: join(".cursor", "skills"),
    };
  }

  getFrontmatter(): CursorSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error(`Frontmatter is not defined in ${join(this.relativeDirPath, this.dirName)}`);
    }
    const result = CursorSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
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

    const result = CursorSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): CursorSkill {
    const settablePaths = CursorSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const cursorFrontmatter: CursorSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new CursorSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: cursorFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("cursor");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CursorSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CursorSkill.getSettablePaths,
    });

    const result = CursorSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CursorSkill({
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
  }: ToolSkillForDeletionParams): CursorSkill {
    const settablePaths = CursorSkill.getSettablePaths({ global });
    return new CursorSkill({
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
