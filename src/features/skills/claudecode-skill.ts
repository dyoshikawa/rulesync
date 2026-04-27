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

export const ClaudecodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "allowed-tools": z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type ClaudecodeSkillFrontmatter = z.infer<typeof ClaudecodeSkillFrontmatterSchema>;

export type ClaudecodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ClaudecodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Claude Code skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 * Extends ToolSkill to inherit directory management and security features from AiDir.
 */
export class ClaudecodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = join(".claude", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ClaudecodeSkillParams) {
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
    global: _global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // Claude Code skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.claude/skills/
    // - Global mode: {getHomeDirectory()}/.claude/skills/
    return {
      relativeDirPath: join(".claude", "skills"),
    };
  }

  getFrontmatter(): ClaudecodeSkillFrontmatter {
    const result = ClaudecodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const claudecodeSection = {
      ...(frontmatter["allowed-tools"] && { "allowed-tools": frontmatter["allowed-tools"] }),
      ...(frontmatter.model && { model: frontmatter.model }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(claudecodeSection).length > 0 && { claudecode: claudecodeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): ClaudecodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(rulesyncFrontmatter.claudecode?.["allowed-tools"] && {
        "allowed-tools": rulesyncFrontmatter.claudecode["allowed-tools"],
      }),
      ...(rulesyncFrontmatter.claudecode?.model && {
        model: rulesyncFrontmatter.claudecode.model,
      }),
      ...(rulesyncFrontmatter.claudecode?.["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": rulesyncFrontmatter.claudecode["disable-model-invocation"],
      }),
    };

    const settablePaths = ClaudecodeSkill.getSettablePaths({ global });

    return new ClaudecodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("claudecode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ClaudecodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ClaudecodeSkill.getSettablePaths,
    });

    const result = ClaudecodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ClaudecodeSkill({
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
  }: ToolSkillForDeletionParams): ClaudecodeSkill {
    return new ClaudecodeSkill({
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
