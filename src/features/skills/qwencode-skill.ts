import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { QWENCODE_SKILLS_DIR_PATH } from "../../constants/qwencode-paths.js";
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

export const QwencodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  priority: z.optional(z.number()),
  paths: z.optional(z.union([z.string(), z.array(z.string())])),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  // Fields Qwen Code's skill-manager parses from SKILL.md (issue #2407):
  // `allowedTools` auto-approves the listed permission rules while the skill
  // is active (v0.18.0); `model` overrides the model for the skill (v0.14.4);
  // `hooks` registers session-scoped hooks in the settings.json shape;
  // `when_to_use` feeds the SkillTool description; `argument-hint` is shown
  // in slash-command completion.
  allowedTools: z.optional(z.array(z.string())),
  model: z.optional(z.string()),
  hooks: z.optional(z.record(z.string(), z.unknown())),
  when_to_use: z.optional(z.string()),
  "argument-hint": z.optional(z.string()),
});

export type QwencodeSkillFrontmatter = z.infer<typeof QwencodeSkillFrontmatterSchema>;

/**
 * Shape of the `qwencode` section stored inside a RulesyncSkill frontmatter.
 * The RulesyncSkill frontmatter schema is a `z.looseObject`, so this section is
 * accepted at runtime even though it is not part of `RulesyncSkillFrontmatterInput`.
 */
type QwencodeRulesyncSection = {
  priority?: number;
  paths?: string | string[];
  "user-invocable"?: boolean;
  "disable-model-invocation"?: boolean;
  allowedTools?: string[];
  model?: string;
  hooks?: Record<string, unknown>;
  when_to_use?: string;
  "argument-hint"?: string;
};

/**
 * Qwen Code's `parsePathsField` throws for any non-array `paths` value and the
 * throw drops the whole skill at load time, so a scalar authored in the
 * canonical config is coerced to a one-element array on emit (the same
 * normalization the qwencode rules adapter applies).
 */
function normalizeQwencodePaths(paths: string | string[]): string[] {
  return Array.isArray(paths) ? paths : [paths];
}

export type QwencodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: QwencodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Qwen Code skill directory.
 * Like Claude Code, Qwen Code skills are directories containing SKILL.md and
 * optional supporting files. Extends ToolSkill to inherit directory management
 * and security features from AiDir.
 */
export class QwencodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = QWENCODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: QwencodeSkillParams) {
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
    return {
      relativeDirPath: QWENCODE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): QwencodeSkillFrontmatter {
    const result = QwencodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = QwencodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const qwencodeSection: QwencodeRulesyncSection = {
      ...(frontmatter.priority !== undefined && { priority: frontmatter.priority }),
      ...(frontmatter.paths !== undefined && { paths: frontmatter.paths }),
      ...(frontmatter["user-invocable"] !== undefined && {
        "user-invocable": frontmatter["user-invocable"],
      }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
      ...(frontmatter.allowedTools !== undefined && { allowedTools: frontmatter.allowedTools }),
      ...(frontmatter.model !== undefined && { model: frontmatter.model }),
      ...(frontmatter.hooks !== undefined && { hooks: frontmatter.hooks }),
      ...(frontmatter.when_to_use !== undefined && { when_to_use: frontmatter.when_to_use }),
      ...(frontmatter["argument-hint"] !== undefined && {
        "argument-hint": frontmatter["argument-hint"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(qwencodeSection).length > 0 && { qwencode: qwencodeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): QwencodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const qwencodeSection = (rulesyncFrontmatter as { qwencode?: QwencodeRulesyncSection })
      .qwencode;
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: qwencodeSection,
    });
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: qwencodeSection,
    });

    const qwencodeFrontmatter: QwencodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(qwencodeSection?.priority !== undefined && { priority: qwencodeSection.priority }),
      ...(qwencodeSection?.paths !== undefined && {
        paths: normalizeQwencodePaths(qwencodeSection.paths),
      }),
      ...(resolvedUserInvocable !== undefined && {
        "user-invocable": resolvedUserInvocable,
      }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(qwencodeSection?.allowedTools !== undefined && {
        allowedTools: qwencodeSection.allowedTools,
      }),
      ...(qwencodeSection?.model !== undefined && { model: qwencodeSection.model }),
      ...(qwencodeSection?.hooks !== undefined && { hooks: qwencodeSection.hooks }),
      ...(qwencodeSection?.when_to_use !== undefined && {
        when_to_use: qwencodeSection.when_to_use,
      }),
      ...(qwencodeSection?.["argument-hint"] !== undefined && {
        "argument-hint": qwencodeSection["argument-hint"],
      }),
    };

    const settablePaths = QwencodeSkill.getSettablePaths({ global });

    return new QwencodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: qwencodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;
    return targets.includes("*") || targets.includes("qwencode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<QwencodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: QwencodeSkill.getSettablePaths,
    });

    const result = QwencodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new QwencodeSkill({
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
  }: ToolSkillForDeletionParams): QwencodeSkill {
    return new QwencodeSkill({
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
