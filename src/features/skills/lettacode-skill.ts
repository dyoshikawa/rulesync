import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  LETTACODE_GLOBAL_SKILLS_DIR_PATH,
  LETTACODE_PROJECT_SKILLS_DIR_PATH,
} from "../../constants/lettacode-paths.js";
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

// Letta Code reads `name`, `description`, `when_to_use`, `argument-hint`,
// `category`, `tags` and the two invocation flags from a skill's frontmatter
// (`parseSkillFile` in `src/agent/skills.ts`). Unknown keys are ignored
// upstream, so the schema stays loose and an imported file carrying extra keys
// still parses.
// @see https://docs.letta.com/configuration/skills/index.md
export const LettacodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
});

export type LettacodeSkillFrontmatter = z.infer<typeof LettacodeSkillFrontmatterSchema>;

export type LettacodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: LettacodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Letta Code skill directory (`<name>/SKILL.md`).
 *
 * Letta Code discovers project skills from `.agents/skills/` (the shared Agent
 * Skills root) and user skills from `~/.letta/skills/`.
 *
 * @see https://docs.letta.com/configuration/skills/index.md
 */
export class LettacodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = LETTACODE_PROJECT_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: LettacodeSkillParams) {
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: global
        ? LETTACODE_GLOBAL_SKILLS_DIR_PATH
        : LETTACODE_PROJECT_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): LettacodeSkillFrontmatter {
    return LettacodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = LettacodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const { name, description, ...rest } = this.getFrontmatter();
    // Tool-specific keys go into the `lettacode` section, not the root: the
    // root-level flags are shared defaults for every tool that honors them.
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(rest).length > 0 && { lettacode: rest }),
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
  }: ToolSkillFromRulesyncSkillParams): LettacodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const lettacodeSection = rulesyncFrontmatter.lettacode;
    // The invocation flags fall back to the shared root-level defaults when
    // the `lettacode` section omits them.
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: lettacodeSection,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: lettacodeSection,
    });

    const lettacodeFrontmatter: LettacodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...lettacodeSection,
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    const settablePaths = LettacodeSkill.getSettablePaths({ global });

    return new LettacodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: lettacodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("lettacode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<LettacodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: LettacodeSkill.getSettablePaths,
    });

    const result = LettacodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new LettacodeSkill({
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
  }: ToolSkillForDeletionParams): LettacodeSkill {
    return new LettacodeSkill({
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
