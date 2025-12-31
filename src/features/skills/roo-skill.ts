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

export const RooSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type RooSkillFrontmatter = z.infer<typeof RooSkillFrontmatterSchema>;

export type RooSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: RooSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Roo Code skill directory.
 * Skills can be stored under .roo/skills or .roo/skills-{modeSlug} directories with SKILL.md files.
 */
export class RooSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".roo", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: RooSkillParams) {
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
    modeSlug,
  }: {
    global?: boolean;
    modeSlug?: string;
  } = {}): ToolSkillSettablePaths {
    // Note: Roo Code uses the same relative path structure for both project and global modes.
    // Project: .roo/skills/ or .roo/skills-{modeSlug}/
    // Global: ~/.roo/skills/ or ~/.roo/skills-{modeSlug}/
    // The _global parameter is accepted for interface consistency but doesn't affect the path.
    const skillsDir = modeSlug ? `skills-${modeSlug}` : "skills";
    return {
      relativeDirPath: join(".roo", skillsDir),
    };
  }

  getFrontmatter(): RooSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = RooSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
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

    const result = RooSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`,
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
    modeSlug,
  }: ToolSkillFromRulesyncSkillParams & { modeSlug?: string }): RooSkill {
    const settablePaths = RooSkill.getSettablePaths({ global, modeSlug });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const rooFrontmatter: RooSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new RooSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rooFrontmatter.name,
      frontmatter: rooFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("roo");
  }

  static async fromDir({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
    modeSlug,
  }: ToolSkillFromDirParams & { modeSlug?: string }): Promise<RooSkill> {
    const loaded = await this.loadSkillDirContent({
      baseDir,
      relativeDirPath,
      dirName,
      global,
      getSettablePaths: (options) => RooSkill.getSettablePaths({ ...options, modeSlug }),
    });

    const result = RooSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    if (result.data.name !== loaded.dirName) {
      const skillFilePath = join(
        loaded.baseDir,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME,
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`,
      );
    }

    return new RooSkill({
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
    modeSlug,
  }: ToolSkillForDeletionParams & { modeSlug?: string }): RooSkill {
    const settablePaths = RooSkill.getSettablePaths({ global, modeSlug });
    const resolvedRelativeDirPath =
      modeSlug !== undefined ? settablePaths.relativeDirPath : relativeDirPath;
    return new RooSkill({
      baseDir,
      relativeDirPath: resolvedRelativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
