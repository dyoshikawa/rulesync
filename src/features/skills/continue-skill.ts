import { join } from "node:path";

import { z } from "zod/mini";

import { CONTINUE_SKILLS_DIR_PATH } from "../../constants/continue-paths.js";
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

// Continue skill frontmatter: `name` and `description` are required as in the
// Agent Skills spec (Continue additionally rejects empty strings at load time,
// like the sibling adapters this schema mirrors); Continue validates nothing
// else.
// @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/util/loadMarkdownSkills.ts
const ContinueSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type ContinueSkillFrontmatter = z.infer<typeof ContinueSkillFrontmatterSchema>;

export type ContinueSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ContinueSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Continue skill directory.
 *
 * Continue discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.continue/skills/` (project scope) and `~/.continue/skills/`
 * (user scope); it also reads `.claude/skills/`, which the claudecode target
 * covers. The frontmatter requires `name` (matching the directory name) and
 * `description`; supporting files next to `SKILL.md` are carried along.
 *
 * @see https://github.com/continuedev/continue/blob/main/extensions/cli/src/util/loadMarkdownSkills.ts
 */
export class ContinueSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CONTINUE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ContinueSkillParams) {
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
    // The processor supplies the home directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.continue/skills/
    // - Global mode: {getHomeDirectory()}/.continue/skills/
    return {
      relativeDirPath: CONTINUE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): ContinueSkillFrontmatter {
    const result = ContinueSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = ContinueSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    // Everything beyond `name` / `description` (any key a hand-written
    // SKILL.md carries) is lifted into the `continue` section so it survives
    // the round-trip (mirrors roo-skill.ts).
    const { name, description, ...continueSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(continueSection).length > 0 && { continue: continueSection }),
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
  }: ToolSkillFromRulesyncSkillParams): ContinueSkill {
    const settablePaths = ContinueSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `continue` section carries Continue-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...continueSection
    } = rulesyncFrontmatter.continue ?? {};
    const continueFrontmatter: ContinueSkillFrontmatter = {
      ...continueSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new ContinueSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: continueFrontmatter.name,
      frontmatter: continueFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("continue");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ContinueSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ContinueSkill.getSettablePaths,
    });

    const result = ContinueSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    if (result.data.name !== loaded.dirName) {
      const skillFilePath = join(
        loaded.outputRoot,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME,
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`,
      );
    }

    return new ContinueSkill({
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
  }: ToolSkillForDeletionParams): ContinueSkill {
    return new ContinueSkill({
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
