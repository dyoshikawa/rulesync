import { join } from "node:path";

import { z } from "zod/mini";

import { DSH_SKILLS_DIR_PATH } from "../../constants/dsh-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  resolveDisableModelInvocation,
  resolveMetadata,
  resolveUserInvocable,
} from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// DeepSeek Harness skills are `<name>/SKILL.md` bundles (or flat `<name>.md`
// files) whose YAML frontmatter `dsh-skill-filesystem` reads as: required
// `name` and `description`, optional `whenToUse` (extra trigger-timing
// context), `metadata` (a free-form object), and the two invocation flags
// `disable-model-invocation` / `user-invocable`. The harness also accepts
// `yes`/`no`, `on`/`off` and `1`/`0` spellings for the flags and drops the
// whole skill on any other value; rulesync emits and imports the canonical
// boolean form only, so the schema types them as booleans. Unknown keys are
// ignored upstream, so the schema stays loose and an imported file carrying
// extra keys still parses.
// @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md
export const DshSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  whenToUse: z.optional(z.string()),
  metadata: z.optional(z.looseObject({})),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
});

export type DshSkillFrontmatter = z.infer<typeof DshSkillFrontmatterSchema>;

export type DshSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: DshSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a DeepSeek Harness skill directory.
 *
 * The harness scans `<projectRoot>/.dsh/skills` (project) and
 * `~/.dsh/skills` (global, the `$DSH_HOME` default) — plus the `.agents/skills`
 * roots the `agentsskills` target already writes — and discovers only the
 * top-level entries of each root: a `<name>/SKILL.md` bundle or a flat
 * `<name>.md` file. Nested `SKILL.md` files below a bundle are deliberately
 * not discovered, which matches what rulesync emits: one top-level bundle per
 * skill, supporting files carried inside it as plain files.
 *
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/skill/skill-filesystem/README.md
 */
export class DshSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = DSH_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: DshSkillParams) {
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
    // The same relative path serves both scopes; the processor supplies the
    // home directory as outputRoot in global mode (`~/.dsh/skills`).
    return {
      relativeDirPath: DSH_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): DshSkillFrontmatter {
    return DshSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = DshSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // Into the `dsh` section, not the root: the root-level flags and
    // `metadata` are shared defaults for every tool that honours them, so
    // importing one tool's setting there would apply it to the rest.
    const dshSection = {
      ...(frontmatter.whenToUse !== undefined && { whenToUse: frontmatter.whenToUse }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
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
      ...(Object.keys(dshSection).length > 0 && { dsh: dshSection }),
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
  }: ToolSkillFromRulesyncSkillParams): DshSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dshSection = rulesyncFrontmatter.dsh;
    // The invocation flags and `metadata` fall back to the shared root-level
    // defaults when the `dsh` section omits them; `whenToUse` is `dsh`-only
    // and has no root-level equivalent.
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: dshSection,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: dshSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: dshSection,
    });

    const dshFrontmatter: DshSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(dshSection?.whenToUse !== undefined && { whenToUse: dshSection.whenToUse }),
      ...(metadata !== undefined && { metadata }),
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    const settablePaths = DshSkill.getSettablePaths({ global });

    return new DshSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: dshFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("dsh");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<DshSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: DshSkill.getSettablePaths,
    });

    const result = DshSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new DshSkill({
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
  }: ToolSkillForDeletionParams): DshSkill {
    return new DshSkill({
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
