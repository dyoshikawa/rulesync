import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  REASONIX_SKILLS_DIR_PATH,
  REASONIX_SUBAGENT_RUN_AS,
} from "../../constants/reasonix-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// Reasonix skills use the Anthropic Agent Skills format: a `<name>/SKILL.md`
// directory whose YAML frontmatter carries `name`/`description` (the same shape
// the canonical rulesync skill adapter emits). Reasonix supports additional
// optional keys (allowed-tools/model/effort/…), but rulesync models only the
// portable `name`/`description` pair; the schema is loose so any extra keys on
// an imported file survive the round-trip.
export const ReasonixSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type ReasonixSkillFrontmatter = z.infer<typeof ReasonixSkillFrontmatterSchema>;

export type ReasonixSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ReasonixSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a DeepSeek-Reasonix skill directory.
 *
 * Reasonix discovers directory-layout skills (`<name>/SKILL.md`) under
 * `.reasonix/skills/` (project) and `~/.reasonix/skills/` (global); the global
 * scope is served by the processor supplying the home directory as outputRoot.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/GUIDE.md
 */
export class ReasonixSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = REASONIX_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ReasonixSkillParams) {
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
      relativeDirPath: REASONIX_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): ReasonixSkillFrontmatter {
    return ReasonixSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = ReasonixSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
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
  }: ToolSkillFromRulesyncSkillParams): ReasonixSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const reasonixFrontmatter: ReasonixSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    const settablePaths = ReasonixSkill.getSettablePaths({ global });

    return new ReasonixSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: reasonixFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;
    return targets.includes("*") || targets.includes("reasonix");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ReasonixSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ReasonixSkill.getSettablePaths,
    });

    const result = ReasonixSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ReasonixSkill({
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

  /**
   * Whether the skill directory belongs to the skills feature.
   *
   * `.reasonix/skills/` is shared with the subagents feature: a directory whose
   * SKILL.md declares `runAs: subagent` is a subagent profile, not a regular
   * skill, so it must be neither imported as a skill nor deleted as an orphan
   * skill. Directories without a readable/parsable SKILL.md keep the default
   * skills-feature ownership, matching the previous behavior for such dirs.
   */
  static async isDirOwned({
    outputRoot,
    relativeDirPath,
    dirName,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
  }): Promise<boolean> {
    const skillFilePath = join(outputRoot, relativeDirPath, dirName, SKILL_FILE_NAME);
    try {
      const fileContent = await readFileContent(skillFilePath);
      const { frontmatter } = parseFrontmatter(fileContent, skillFilePath);
      return frontmatter["runAs"] !== REASONIX_SUBAGENT_RUN_AS;
    } catch {
      return true;
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): ReasonixSkill {
    return new ReasonixSkill({
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
