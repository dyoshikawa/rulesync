import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { TABNINE_SKILLS_DIR_PATH } from "../../constants/tabnine-paths.js";
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

const TabnineSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type TabnineSkillFrontmatter = z.infer<typeof TabnineSkillFrontmatterSchema>;

export type TabnineSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: TabnineSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Tabnine CLI skill directory.
 *
 * Tabnine CLI discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.tabnine/agent/skills/` (workspace scope) and
 * `~/.tabnine/agent/skills/` (user scope); the workspace copy wins on a name
 * clash. The frontmatter requires `name` (matching the directory name) and
 * `description`; supporting files next to `SKILL.md` are carried along.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/agent-skills
 */
export class TabnineSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = TABNINE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: TabnineSkillParams) {
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
    // Both scopes use the same relative path; the processor supplies the home
    // directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.tabnine/agent/skills/
    // - Global mode: {getHomeDirectory()}/.tabnine/agent/skills/
    return {
      relativeDirPath: TABNINE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): TabnineSkillFrontmatter {
    const result = TabnineSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = TabnineSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // Tabnine documents only `name` / `description`; any other key a hand-written
    // SKILL.md carries is lifted into the `tabnine` section so it survives the
    // round-trip (mirrors how roo-skill.ts consumes its section).
    const { name, description, ...tabnineSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(tabnineSection).length > 0 && { tabnine: tabnineSection }),
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
  }: ToolSkillFromRulesyncSkillParams): TabnineSkill {
    const settablePaths = TabnineSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `tabnine` section carries Tabnine-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...tabnineSection
    } = rulesyncFrontmatter.tabnine ?? {};
    const tabnineFrontmatter: TabnineSkillFrontmatter = {
      ...tabnineSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new TabnineSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: tabnineFrontmatter.name,
      frontmatter: tabnineFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("tabnine");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<TabnineSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: TabnineSkill.getSettablePaths,
    });

    const result = TabnineSkillFrontmatterSchema.safeParse(loaded.frontmatter);
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

    return new TabnineSkill({
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
  }: ToolSkillForDeletionParams): TabnineSkill {
    return new TabnineSkill({
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
