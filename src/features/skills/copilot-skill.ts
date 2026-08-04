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
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const CopilotSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  license: z.optional(z.string()),
  // Pre-approved tools the agent may run without per-use confirmation.
  // https://docs.github.com/en/copilot/how-tos/copilot-on-github/customize-copilot/customize-cloud-agent/add-skills
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  // Hint shown for the skill's expected arguments.
  // https://code.visualstudio.com/docs/agent-customization/agent-skills
  "argument-hint": z.optional(z.string()),
  // The two invocation gates: `user-invocable` (default true) controls
  // `/SKILL-NAME`, `disable-model-invocation` (default false) stops the agent
  // from picking the skill up on its own.
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  // Experimental execution context, `fork` to run the skill in a forked
  // session. Added in VS Code 1.118. Typed as a free string rather than the one
  // documented literal so a value added later still round-trips.
  // https://code.visualstudio.com/updates/v1_118
  context: z.optional(z.string()),
});

export type CopilotSkillFrontmatter = z.infer<typeof CopilotSkillFrontmatterSchema>;

export type CopilotSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CopilotSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a GitHub Copilot skill directory.
 *
 * Copilot discovers project skills from `.github/skills/` and personal/global
 * skills from `~/.copilot/skills/`. Each skill is a directory containing a
 * `SKILL.md` file with `name`/`description` frontmatter.
 * https://docs.github.com/en/copilot/concepts/agents/about-agent-skills
 */
export class CopilotSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = COPILOT_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CopilotSkillParams) {
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

  getFrontmatter(): CopilotSkillFrontmatter {
    const result = CopilotSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = CopilotSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const copilotSection = {
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
      ...(frontmatter.context !== undefined && { context: frontmatter.context }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(copilotSection).length > 0 && { copilot: copilotSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CopilotSkill {
    const settablePaths = CopilotSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const copilotSection = rulesyncFrontmatter.copilot;
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: copilotSection,
    });
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: copilotSection,
    });

    const copilotFrontmatter: CopilotSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(copilotSection?.license !== undefined && {
        license: copilotSection.license,
      }),
      ...(copilotSection?.["allowed-tools"] !== undefined && {
        "allowed-tools": copilotSection["allowed-tools"],
      }),
      ...(copilotSection?.["argument-hint"] !== undefined && {
        "argument-hint": copilotSection["argument-hint"],
      }),
      ...(resolvedUserInvocable !== undefined && { "user-invocable": resolvedUserInvocable }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(copilotSection?.context !== undefined && { context: copilotSection.context }),
    };

    return new CopilotSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: copilotFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("copilot");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CopilotSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CopilotSkill.getSettablePaths,
    });

    const result = CopilotSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CopilotSkill({
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
  }: ToolSkillForDeletionParams): CopilotSkill {
    const settablePaths = CopilotSkill.getSettablePaths({ global });
    return new CopilotSkill({
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
