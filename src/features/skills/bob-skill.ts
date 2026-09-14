import { join } from "node:path";

import { z } from "zod/mini";

import { BOB_SKILLS_DIR_PATH } from "../../constants/bob-paths.js";
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

const BobSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type BobSkillFrontmatter = z.infer<typeof BobSkillFrontmatterSchema>;

export type BobSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: BobSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents an IBM Bob skill directory.
 *
 * Bob discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.bob/skills/` (project scope) and `~/.bob/skills/` (user scope);
 * the project copy wins on a name clash. The frontmatter requires `name`
 * (matching the directory name) and `description`; supporting files next to
 * `SKILL.md` are carried along.
 *
 * @see https://bob.ibm.com/docs/ide/features/skills
 */
export class BobSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = BOB_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: BobSkillParams) {
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
    // - Project mode: {process.cwd()}/.bob/skills/
    // - Global mode: {getHomeDirectory()}/.bob/skills/
    return {
      relativeDirPath: BOB_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): BobSkillFrontmatter {
    const result = BobSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = BobSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // Bob documents only `name` / `description`; any other key a hand-written
    // SKILL.md carries is lifted into the `bob` section so it survives the
    // round-trip (mirrors how roo-skill.ts consumes its section).
    const { name, description, ...bobSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(bobSection).length > 0 && { bob: bobSection }),
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
  }: ToolSkillFromRulesyncSkillParams): BobSkill {
    const settablePaths = BobSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `bob` section carries Bob-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...bobSection
    } = rulesyncFrontmatter.bob ?? {};
    const bobFrontmatter: BobSkillFrontmatter = {
      ...bobSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new BobSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: bobFrontmatter.name,
      frontmatter: bobFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("bob");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<BobSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: BobSkill.getSettablePaths,
    });

    const result = BobSkillFrontmatterSchema.safeParse(loaded.frontmatter);
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

    return new BobSkill({
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
  }: ToolSkillForDeletionParams): BobSkill {
    return new BobSkill({
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
