import { join } from "node:path";

import { z } from "zod/mini";

import {
  COPILOT_SKILLS_DIR_PATH,
  COPILOT_SKILLS_GLOBAL_DIR_PATH,
} from "../../constants/copilot-paths.js";
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

export const CopilotcliSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  license: z.optional(z.string()),
  // Pre-approved tools the agent may run without per-use confirmation.
  // https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // Hint shown for the skill's expected arguments. Added in Copilot CLI v1.0.62
  // (2026-06-13). https://github.com/github/copilot-cli/blob/main/changelog.md
  "argument-hint": z.optional(z.string()),
  // Whether users can invoke the skill with `/SKILL-NAME` (default true).
  // v1.0.71 (2026-07-16) marks disabled skills in `copilot skill list`.
  "user-invocable": z.optional(z.boolean()),
  // Prevent the agent from automatically invoking the skill (default false).
  // v1.0.74 (2026-07-23) "fully honors" the flag.
  // https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-command-reference
  "disable-model-invocation": z.optional(z.boolean()),
});

export type CopilotcliSkillFrontmatter = z.infer<typeof CopilotcliSkillFrontmatterSchema>;

export type CopilotcliSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CopilotcliSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a GitHub Copilot CLI skill directory.
 *
 * Copilot CLI discovers project skills from `.github/skills/` (shared with the
 * Copilot IDE target) and personal/global skills from `~/.copilot/skills/`. Each
 * skill is a directory containing a `SKILL.md` file with `name`/`description`
 * frontmatter. https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-skills
 */
export class CopilotcliSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = COPILOT_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CopilotcliSkillParams) {
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

  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    if (options?.global) {
      return {
        relativeDirPath: COPILOT_SKILLS_GLOBAL_DIR_PATH,
      };
    }
    return {
      relativeDirPath: COPILOT_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CopilotcliSkillFrontmatter {
    const result = CopilotcliSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = CopilotcliSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const copilotcliSection = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
      ...(frontmatter["argument-hint"] !== undefined && {
        "argument-hint": frontmatter["argument-hint"],
      }),
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(copilotcliSection).length > 0 && { copilotcli: copilotcliSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CopilotcliSkill {
    const settablePaths = CopilotcliSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const copilotcliFrontmatter: CopilotcliSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(rulesyncFrontmatter.copilotcli?.license !== undefined && {
        license: rulesyncFrontmatter.copilotcli.license,
      }),
      ...(rulesyncFrontmatter.copilotcli?.["allowed-tools"] !== undefined && {
        "allowed-tools": rulesyncFrontmatter.copilotcli["allowed-tools"],
      }),
      ...(rulesyncFrontmatter.copilotcli?.["argument-hint"] !== undefined && {
        "argument-hint": rulesyncFrontmatter.copilotcli["argument-hint"],
      }),
      ...(rulesyncFrontmatter.copilotcli?.["user-invocable"] !== undefined && {
        "user-invocable": rulesyncFrontmatter.copilotcli["user-invocable"],
      }),
      ...(rulesyncFrontmatter.copilotcli?.["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": rulesyncFrontmatter.copilotcli["disable-model-invocation"],
      }),
    };

    return new CopilotcliSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: copilotcliFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("copilotcli");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CopilotcliSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CopilotcliSkill.getSettablePaths,
    });

    const result = CopilotcliSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CopilotcliSkill({
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
  }: ToolSkillForDeletionParams): CopilotcliSkill {
    const settablePaths = CopilotcliSkill.getSettablePaths({ global });
    return new CopilotcliSkill({
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
