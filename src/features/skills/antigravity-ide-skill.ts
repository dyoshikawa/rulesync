import { join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import {
  AntigravitySkillFrontmatter,
  AntigravitySkillFrontmatterSchema,
} from "./antigravity-skill.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export type AntigravityIdeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: AntigravitySkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Google Antigravity IDE skill directory (Antigravity 2.0).
 *
 * This is the v2 successor of {@link AntigravitySkill}; it defaults to the new
 * plural `.agents/skills/` directory (project scope) and keeps the IDE's global
 * skill location `~/.gemini/antigravity/skills/`. The singular `.agent/skills/`
 * tree is handled by the deprecated `antigravity` alias for back-compat.
 */
export class AntigravityIdeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = join(".agents", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: AntigravityIdeSkillParams) {
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

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // - Project mode: {process.cwd()}/.agents/skills/
    // - Global mode: {getHomeDirectory()}/.gemini/antigravity/skills/
    if (global) {
      return {
        relativeDirPath: join(".gemini", "antigravity", "skills"),
      };
    }
    return {
      relativeDirPath: join(".agents", "skills"),
    };
  }

  getFrontmatter(): AntigravitySkillFrontmatter {
    const result = AntigravitySkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = AntigravitySkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
  }: ToolSkillFromRulesyncSkillParams): AntigravityIdeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const antigravityFrontmatter: AntigravitySkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    const settablePaths = AntigravityIdeSkill.getSettablePaths({ global });

    return new AntigravityIdeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: antigravityFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("antigravity-ide");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AntigravityIdeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: AntigravityIdeSkill.getSettablePaths,
    });

    const result = AntigravitySkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new AntigravityIdeSkill({
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
  }: ToolSkillForDeletionParams): AntigravityIdeSkill {
    return new AntigravityIdeSkill({
      outputRoot,
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
