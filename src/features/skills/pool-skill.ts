import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  POOL_SHARED_SKILLS_DIR_PATH,
  POOL_SKILLS_GLOBAL_DIR,
  POOL_SKILLS_PROJECT_DIR,
} from "../../constants/pool-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import type { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import {
  RulesyncSkill,
  type RulesyncSkillFrontmatterInput,
  type SkillFile,
} from "./rulesync-skill.js";
import { resolveCompatibility, resolveLicense, resolveMetadata } from "./skills-utils.js";
import {
  ToolSkill,
  type ToolSkillForDeletionParams,
  type ToolSkillFromDirParams,
  type ToolSkillFromRulesyncSkillParams,
  type ToolSkillSettablePaths,
} from "./tool-skill.js";

const PoolSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
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
 * Represents a Pool (Poolside) Agent Skill directory.
 *
 * Pool discovers directory-layout skills (`<name>/SKILL.md`) from
 * `.poolside/skills/` at project scope and `~/.config/poolside/skills/` at
 * global scope. It also reads the shared `.agents/skills/` tree at both
 * scopes; this target writes only the Pool-specific paths.
 *
 * @see https://docs.poolside.ai/skills
 */
export class PoolSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = POOL_SKILLS_PROJECT_DIR,
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
      relativeDirPath: global ? POOL_SKILLS_GLOBAL_DIR : POOL_SKILLS_PROJECT_DIR,
      importOnlySkillRoots: [POOL_SHARED_SKILLS_DIR_PATH],
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
    const allowedTools = frontmatter["allowed-tools"];
    const poolSection = {
      ...(allowedTools !== undefined && { "allowed-tools": allowedTools }),
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && {
        compatibility: frontmatter.compatibility,
      }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(poolSection).length > 0 && { pool: poolSection }),
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
  }: ToolSkillFromRulesyncSkillParams): PoolSkill {
    const settablePaths = PoolSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const poolSection = rulesyncFrontmatter.pool ?? {};

    const license = resolveLicense({
      rootFrontmatter: rulesyncFrontmatter,
      section: poolSection,
    });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: poolSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: poolSection,
    });

    const poolFrontmatter: PoolSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(poolSection["allowed-tools"] !== undefined && {
        "allowed-tools": poolSection["allowed-tools"],
      }),
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
    };

    return new PoolSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
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
