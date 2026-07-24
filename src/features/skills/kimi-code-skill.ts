import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { KIMI_CODE_SKILLS_DIR_PATH } from "../../constants/kimi-code-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import {
  RulesyncSkill,
  type RulesyncSkillFrontmatterInput,
  type SkillFile,
} from "./rulesync-skill.js";
import {
  ToolSkill,
  type ToolSkillForDeletionParams,
  type ToolSkillFromDirParams,
  type ToolSkillFromRulesyncSkillParams,
  type ToolSkillSettablePaths,
} from "./tool-skill.js";

const KimiCodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  type: z.optional(z.enum(["prompt", "inline", "flow"])),
  whenToUse: z.optional(z.string()),
  disableModelInvocation: z.optional(z.boolean()),
  arguments: z.optional(z.union([z.string(), z.array(z.string())])),
});

type KimiCodeSkillFrontmatter = z.infer<typeof KimiCodeSkillFrontmatterSchema>;

type KimiCodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: KimiCodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Kimi Code Agent Skill.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/skills.html
 */
export class KimiCodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = KIMI_CODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: KimiCodeSkillParams) {
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return { relativeDirPath: KIMI_CODE_SKILLS_DIR_PATH };
  }

  getFrontmatter(): KimiCodeSkillFrontmatter {
    return KimiCodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = KimiCodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    return result.success
      ? { success: true, error: null }
      : {
          success: false,
          error: new Error(
            `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
          ),
        };
  }

  toRulesyncSkill(): RulesyncSkill {
    const { name, description, disableModelInvocation, ...kimiCodeFrontmatter } =
      this.getFrontmatter();
    const toolSection = {
      ...kimiCodeFrontmatter,
      ...(disableModelInvocation !== undefined && { disableModelInvocation }),
    };

    const frontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(Object.keys(toolSection).length > 0 && { "kimi-code": toolSection }),
    };

    return new RulesyncSkill({
      outputRoot: this.outputRoot,
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
      dirName: this.getDirName(),
      frontmatter,
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
  }: ToolSkillFromRulesyncSkillParams): KimiCodeSkill {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const kimiCodeSection = frontmatter["kimi-code"] ?? {};
    const kimiCodeFrontmatter: KimiCodeSkillFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        disableModelInvocation: frontmatter["disable-model-invocation"],
      }),
      ...kimiCodeSection,
    };

    return new KimiCodeSkill({
      outputRoot,
      relativeDirPath: this.getSettablePaths({ global }).relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: kimiCodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kimi-code");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<KimiCodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: KimiCodeSkill.getSettablePaths,
    });
    const result = KimiCodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }
    return new KimiCodeSkill({
      ...loaded,
      frontmatter: result.data,
      validate: true,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): KimiCodeSkill {
    return new KimiCodeSkill({
      outputRoot,
      relativeDirPath: relativeDirPath ?? this.getSettablePaths({ global }).relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      validate: false,
      global,
    });
  }
}
