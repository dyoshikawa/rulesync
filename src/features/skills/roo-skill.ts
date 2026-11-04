import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ROO_SKILLS_DIR_PATH } from "../../constants/roo-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const RooSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type RooSkillFrontmatter = z.infer<typeof RooSkillFrontmatterSchema>;

export type RooSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: RooSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Roo Code skill directory.
 * Skills are stored under .roo/skills/ directories with SKILL.md files.
 */
export class RooSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = ROO_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: RooSkillParams) {
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
    // Roo Code skills use the same relative path for both project and global modes
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.roo/skills/
    // - Global mode: {getHomeDirectory()}/.roo/skills/
    return {
      relativeDirPath: ROO_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): RooSkillFrontmatter {
    const result = RooSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatterAndDirName(RooSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    // Keys beyond name/description — Roo's `modeSlugs` mode targeting, the
    // legacy single `mode`, and anything Roo's frozen final release accepts —
    // are lifted into the `roo` section so they survive the round-trip
    // (mirrors how claudecode-skill.ts consumes its section).
    const { name, description, ...rooSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(rooSection).length > 0 && { roo: rooSection }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): RooSkill {
    const settablePaths = RooSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `roo` section carries Roo-specific frontmatter (`modeSlugs` mode
    // targeting, etc.); canonical name/description always win over a stray
    // same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...rooSection
    } = rulesyncFrontmatter.roo ?? {};
    const rooFrontmatter: RooSkillFrontmatter = {
      ...rooSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new RooSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rooFrontmatter.name,
      frontmatter: rooFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget: ToolTarget = "roo";

  static async fromDir(params: ToolSkillFromDirParams): Promise<RooSkill> {
    return new RooSkill(
      await this.loadStandardSkillParamsMatchingDirName({
        params,
        schema: RooSkillFrontmatterSchema,
      }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): RooSkill {
    return new RooSkill(this.forDeletionParams(params));
  }
}
