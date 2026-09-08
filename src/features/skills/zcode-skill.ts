import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ZCODE_SKILLS_DIR_PATH } from "../../constants/zcode-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveLicense, resolveMetadata } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// ZCode skills use the Anthropic Agent Skills format: a `<name>/SKILL.md`
// directory whose YAML frontmatter ZCode allowlists to exactly five keys —
// required `name` and `description`, plus optional `when_to_use` (extra
// trigger-timing context), `license`, and `metadata` (an object that may carry
// extras such as `author` / `version`). Fields outside that list "are ignored
// and do not affect loading", so the schema stays loose: an imported file
// carrying extra keys still parses, and only the five documented keys are
// carried into the canonical skill. ZCode documents no `compatibility` field,
// so the canonical `compatibility` is deliberately not emitted here.
// @see https://zcode.z.ai/en/docs/plugin ("Skill SKILL.md Field Reference")
export const ZcodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  when_to_use: z.optional(z.string()),
  license: z.optional(z.string()),
  metadata: z.optional(z.looseObject({})),
});

export type ZcodeSkillFrontmatter = z.infer<typeof ZcodeSkillFrontmatterSchema>;

/**
 * Shape of the `zcode` section stored inside a RulesyncSkill frontmatter.
 * The RulesyncSkill frontmatter schema is a `z.looseObject`, so this section is
 * accepted at runtime even though it is not part of `RulesyncSkillFrontmatterInput`.
 */
type ZcodeRulesyncSection = {
  when_to_use?: string;
  license?: string;
  metadata?: Record<string, unknown>;
};

export type ZcodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ZcodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a ZCode skill directory.
 *
 * ZCode discovers directory-layout skills (`<name>/SKILL.md`) and invokes them
 * with `$name`. The documented location is the user one,
 * `~/.zcode/skills/<name>/SKILL.md`; the workspace scope the import dialog
 * offers is served from the project's own `.zcode/skills/`, which the processor
 * reaches by supplying the home directory as outputRoot only in global mode.
 *
 * ZCode rejects a skill whose `description` exceeds 1024 characters and
 * truncates a body past 100KB when it loads it. Neither is enforced here:
 * rulesync's canonical skill carries whatever the source states, and refusing
 * to write the file would leave the other targets without it too.
 *
 * @see https://zcode.z.ai/en/docs/skill
 */
export class ZcodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = ZCODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ZcodeSkillParams) {
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
      relativeDirPath: ZCODE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): ZcodeSkillFrontmatter {
    return ZcodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = ZcodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const zcodeSection: ZcodeRulesyncSection = {
      ...(frontmatter.when_to_use !== undefined && { when_to_use: frontmatter.when_to_use }),
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(zcodeSection).length > 0 && { zcode: zcodeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): ZcodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const zcodeSection = (rulesyncFrontmatter as { zcode?: ZcodeRulesyncSection }).zcode;
    // `license` and `metadata` fall back to the shared root-level Agent Skills
    // packaging defaults when the `zcode` section omits them; `when_to_use` is
    // ZCode-only and has no root-level equivalent.
    const license = resolveLicense({
      rootFrontmatter: rulesyncFrontmatter,
      section: zcodeSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: zcodeSection,
    });

    const zcodeFrontmatter: ZcodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(zcodeSection?.when_to_use !== undefined && { when_to_use: zcodeSection.when_to_use }),
      ...(license !== undefined && { license }),
      ...(metadata !== undefined && { metadata }),
    };

    const settablePaths = ZcodeSkill.getSettablePaths({ global });

    return new ZcodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: zcodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("zcode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ZcodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ZcodeSkill.getSettablePaths,
    });

    const result = ZcodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ZcodeSkill({
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
  }: ToolSkillForDeletionParams): ZcodeSkill {
    return new ZcodeSkill({
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
