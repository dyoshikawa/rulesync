import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  GOOSE_GLOBAL_SKILLS_DIR_PATH,
  GOOSE_SKILLS_DIR_PATH,
} from "../../constants/goose-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const GooseSkillFrontmatterSchema = z.looseObject({
  // Goose SKILL.md documents only `name` and `description` as required fields.
  // https://goose-docs.ai/docs/guides/context-engineering/using-skills/
  // Any additional fields (e.g. `metadata`) pass through via z.looseObject.
  name: z.string(),
  description: z.string(),
});

export type GooseSkillFrontmatter = z.infer<typeof GooseSkillFrontmatterSchema>;

export type GooseSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: GooseSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Goose skill directory.
 * Skills are stored under the .goose/skills directory (project) or
 * ~/.config/goose/skills (global) with SKILL.md files.
 */
export class GooseSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = GOOSE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: GooseSkillParams) {
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

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Goose-specific roots only; the portable `.agents/skills/` locations are
    // served by the agentsskills target.
    return {
      relativeDirPath: global ? GOOSE_GLOBAL_SKILLS_DIR_PATH : GOOSE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): GooseSkillFrontmatter {
    const result = GooseSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatter(GooseSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): GooseSkill {
    const settablePaths = GooseSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const gooseFrontmatter: GooseSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new GooseSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: gooseFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "goose";

  static async fromDir(params: ToolSkillFromDirParams): Promise<GooseSkill> {
    return new GooseSkill(
      await this.loadStandardSkillParams({ params, schema: GooseSkillFrontmatterSchema }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): GooseSkill {
    return new GooseSkill(this.forDeletionParams(params));
  }
}
