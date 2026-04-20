import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
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

export const ClaudecodeScheduledTaskFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type ClaudecodeScheduledTaskFrontmatter = z.infer<
  typeof ClaudecodeScheduledTaskFrontmatterSchema
>;

export type ClaudecodeScheduledTaskParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ClaudecodeScheduledTaskFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

export class ClaudecodeScheduledTask extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".claude", "scheduled-tasks"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ClaudecodeScheduledTaskParams) {
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

  static getSettablePaths(): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(".claude", "scheduled-tasks"),
    };
  }

  getFrontmatter(): ClaudecodeScheduledTaskFrontmatter {
    const result = ClaudecodeScheduledTaskFrontmatterSchema.parse(
      this.requireMainFileFrontmatter(),
    );
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
    const result = ClaudecodeScheduledTaskFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
      targets: ["claudecode"],
    };

    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: RULESYNC_SCHEDULED_TASKS_RELATIVE_DIR_PATH,
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
  }: ToolSkillFromRulesyncSkillParams): ClaudecodeScheduledTask {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const frontmatter: ClaudecodeScheduledTaskFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new ClaudecodeScheduledTask({
      baseDir,
      relativeDirPath: ClaudecodeScheduledTask.getSettablePaths().relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ClaudecodeScheduledTask> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ClaudecodeScheduledTask.getSettablePaths,
    });

    const result = ClaudecodeScheduledTaskFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.baseDir, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ClaudecodeScheduledTask({
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
  }: ToolSkillForDeletionParams): ClaudecodeScheduledTask {
    return new ClaudecodeScheduledTask({
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
