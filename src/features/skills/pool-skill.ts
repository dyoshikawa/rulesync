import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { POOL_GLOBAL_SKILLS_DIR_PATH, POOL_SKILLS_DIR_PATH } from "../../constants/pool-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { toPosixPath } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// Pool documents only the Agent Skills `name`/`description` pair as required
// and states that it does not enforce `allowed-tools` or `compatibility`, so
// nothing beyond the pair is modeled. The schema stays loose so an imported
// `SKILL.md` carrying other Agent Skills keys still parses.
// https://docs.poolside.ai/skills
const PoolSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type PoolSkillFrontmatter = z.infer<typeof PoolSkillFrontmatterSchema>;

export type PoolSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: PoolSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Pool (Poolside) skill directory.
 *
 * Pool discovers Agent Skills (`<name>/SKILL.md` bundles, optionally with
 * supporting files) from `.poolside/skills/` (project) and
 * `~/.config/poolside/skills/` (global). It also scans the shared
 * `.agents/skills/` / `~/.agents/skills/` roots and the skill directories of
 * other Agent Skills tools; those belong to their own targets, so this class
 * writes only the two Pool-specific roots and a skill is written exactly once.
 * Pool requires the directory name to equal the frontmatter `name`, otherwise
 * it skips the skill.
 * @see https://docs.poolside.ai/skills
 */
export class PoolSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = POOL_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: PoolSkillParams) {
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
    return {
      relativeDirPath: global ? POOL_GLOBAL_SKILLS_DIR_PATH : POOL_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): PoolSkillFrontmatter {
    return PoolSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = PoolSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    logger,
  }: ToolSkillFromRulesyncSkillParams): PoolSkill {
    const settablePaths = PoolSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dirName = rulesyncSkill.getDirName();

    const poolFrontmatter: PoolSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    // Pool skips a skill whose directory name differs from its `name`, and the
    // mismatch is only visible in `/skills` inside Pool, so say so at generate
    // time. The skill is still written: the directory name is the canonical
    // identity shared with every other target.
    if (poolFrontmatter.name !== dirName) {
      const skillPath = join(outputRoot, settablePaths.relativeDirPath, dirName, SKILL_FILE_NAME);
      warnWithFallback(
        logger,
        `${stripControlCharacters(toPosixPath(skillPath))}: \`name\` "${stripControlCharacters(poolFrontmatter.name)}" does not match its directory name "${dirName}"; Pool only loads a skill whose directory name equals its \`name\``,
      );
    }

    return new PoolSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter: poolFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("pool");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<PoolSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: PoolSkill.getSettablePaths,
    });

    const result = PoolSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new PoolSkill({
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
  }: ToolSkillForDeletionParams): PoolSkill {
    const settablePaths = PoolSkill.getSettablePaths({ global });
    return new PoolSkill({
      outputRoot,
      relativeDirPath: relativeDirPath ?? settablePaths.relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
