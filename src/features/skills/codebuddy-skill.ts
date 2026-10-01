import { join } from "node:path";

import { z } from "zod/mini";

import { CODEBUDDY_SKILLS_DIR_PATH } from "../../constants/codebuddy-paths.js";
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

// CodeBuddy Code skill frontmatter. Every field is optional upstream: `name`
// falls back to the directory name and `description` may be omitted. The
// documented optional keys (`allowed-tools`, `context`, `agent`, `model`,
// `hooks`, ...) pass through the `codebuddy` section; the looseObject keeps
// them, and any future key, on import.
// @see https://www.codebuddy.ai/docs/cli/skills
const CodebuddySkillFrontmatterSchema = z.looseObject({
  name: z.optional(z.string()),
  description: z.optional(z.string()),
  "disable-model-invocation": z.optional(z.boolean()),
  "user-invocable": z.optional(z.boolean()),
});

export type CodebuddySkillFrontmatter = z.infer<typeof CodebuddySkillFrontmatterSchema>;

type CodebuddySkillSection = Record<string, unknown> & {
  "disable-model-invocation"?: boolean;
  "user-invocable"?: boolean;
};

export type CodebuddySkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CodebuddySkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a CodeBuddy Code skill directory.
 *
 * CodeBuddy Code discovers `<name>/SKILL.md` directories under
 * `.codebuddy/skills/` (project scope) and `~/.codebuddy/skills/` (user scope);
 * supporting files next to `SKILL.md` are carried along.
 *
 * @see https://www.codebuddy.ai/docs/cli/skills
 */
export class CodebuddySkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CODEBUDDY_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CodebuddySkillParams) {
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
    // home directory as outputRoot in global mode (`~/.codebuddy/skills`).
    return {
      relativeDirPath: CODEBUDDY_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CodebuddySkillFrontmatter {
    return CodebuddySkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = CodebuddySkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // `name` falls back to the directory name and `description` to an empty
    // string, matching how CodeBuddy Code itself treats a SKILL.md without
    // them. Everything else is lifted into the `codebuddy` section so it
    // survives the round-trip.
    const { name, description, ...codebuddySection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: name ?? this.getDirName(),
      description: description ?? "",
      targets: ["*"],
      ...(Object.keys(codebuddySection).length > 0 && { codebuddy: codebuddySection }),
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
  }: ToolSkillFromRulesyncSkillParams): CodebuddySkill {
    const settablePaths = CodebuddySkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // Canonical name/description always win over a stray same-named key in
    // the `codebuddy` section; the shared `disable-model-invocation` /
    // `user-invocable` defaults apply unless the section overrides them.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...codebuddySection
    }: CodebuddySkillSection = rulesyncFrontmatter.codebuddy ?? {};
    const disableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: codebuddySection,
    });
    const userInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: codebuddySection,
    });
    const codebuddyFrontmatter: CodebuddySkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...codebuddySection,
      ...(disableModelInvocation !== undefined && {
        "disable-model-invocation": disableModelInvocation,
      }),
      ...(userInvocable !== undefined && { "user-invocable": userInvocable }),
    };

    return new CodebuddySkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: codebuddyFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("codebuddy");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CodebuddySkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CodebuddySkill.getSettablePaths,
    });

    const result = CodebuddySkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CodebuddySkill({
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
  }: ToolSkillForDeletionParams): CodebuddySkill {
    return new CodebuddySkill({
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
