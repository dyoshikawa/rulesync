import { join } from "node:path";

import { z } from "zod/mini";

import { CURSOR_SKILLS_DIR_PATH } from "../../constants/cursor-paths.js";
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
  // Optional Cursor SKILL.md frontmatter. https://cursor.com/docs/skills
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
  "disable-model-invocation": z.optional(z.boolean()),
  metadata: z.optional(z.looseObject({})),
});

export type CursorSkillFrontmatter = z.infer<typeof CursorSkillFrontmatterSchema>;

export type CursorSkillParams = {
  outputRoot?: string;
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
    outputRoot = process.cwd(),
    relativeDirPath = CURSOR_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CursorSkillParams) {
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

  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    // Cursor skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.cursor/skills/
    // - Global mode: {getHomeDirectory()}/.cursor/skills/
    return {
      relativeDirPath: CURSOR_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CursorSkillFrontmatter {
    const result = CursorSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const cursorSection = {
      ...(frontmatter.paths !== undefined && { paths: frontmatter.paths }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(cursorSection).length > 0 && { cursor: cursorSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CursorSkill {
    const settablePaths = CursorSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const cursorSection = rulesyncFrontmatter.cursor;
    const resolvedDisableModelInvocation =
      cursorSection?.["disable-model-invocation"] ??
      rulesyncFrontmatter["disable-model-invocation"];

    const cursorFrontmatter: CursorSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(cursorSection?.paths !== undefined && { paths: cursorSection.paths }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(cursorSection?.metadata !== undefined && { metadata: cursorSection.metadata }),
    };

    return new CursorSkill({
      outputRoot,
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
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CursorSkill({
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
  }: ToolSkillForDeletionParams): CursorSkill {
    const settablePaths = CursorSkill.getSettablePaths({ global });
    return new CursorSkill({
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
