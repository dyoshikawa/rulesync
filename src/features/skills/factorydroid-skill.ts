import { join } from "node:path";

import { z } from "zod/mini";

import { FACTORYDROID_SKILLS_DIR_PATH } from "../../constants/factorydroid-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3).
// Factory Droid skills are native SKILL.md files with frontmatter.
// See https://docs.factory.ai/cli/configuration/skills
//   - `name`, `description`: identity fields.
//   - `user-invocable`, `disable-model-invocation`: optional behavior flags,
//     passed through verbatim when present.
export const FactorydroidSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type FactorydroidSkillFrontmatter = z.infer<typeof FactorydroidSkillFrontmatterSchema>;

export type FactorydroidSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: FactorydroidSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Factory Droid skill directory.
 * Factory Droid has native skill support — it reads .factory/skills/ directories
 * with SKILL.md files. See https://docs.factory.ai/cli/configuration/skills
 *
 * Supports both project mode (.factory/skills/) and global mode (~/.factory/skills/).
 */
export class FactorydroidSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = FactorydroidSkill.getSettablePaths().relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: FactorydroidSkillParams) {
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
    // Factory Droid skills use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.factory/skills/
    // - Global mode: {getHomeDirectory()}/.factory/skills/
    return {
      relativeDirPath: FACTORYDROID_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): FactorydroidSkillFrontmatter {
    const result = FactorydroidSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = FactorydroidSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const factorydroidBlock = {
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(factorydroidBlock).length > 0 && { factorydroid: factorydroidBlock }),
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
  }: ToolSkillFromRulesyncSkillParams): FactorydroidSkill {
    const settablePaths = FactorydroidSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.factorydroid,
    });
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: rulesyncFrontmatter.factorydroid,
    });

    const factorydroidFrontmatter: FactorydroidSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(resolvedUserInvocable !== undefined && {
        "user-invocable": resolvedUserInvocable,
      }),
    };

    return new FactorydroidSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: factorydroidFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("factorydroid");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<FactorydroidSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: FactorydroidSkill.getSettablePaths,
    });

    const result = FactorydroidSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new FactorydroidSkill({
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
  }: ToolSkillForDeletionParams): FactorydroidSkill {
    const settablePaths = FactorydroidSkill.getSettablePaths({ global });
    return new FactorydroidSkill({
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
