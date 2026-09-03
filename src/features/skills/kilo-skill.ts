import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { KILO_SKILLS_DIR_PATH } from "../../constants/kilo-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveCompatibility, resolveLicense, resolveMetadata } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const KiloSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Kilo Code documents `name`, `description`, `license`, `compatibility`,
  // and `metadata` (https://kilo.ai/docs/customize/skills), but its SKILL.md
  // parser is forked from OpenCode's engine, whose `Frontmatter` schema
  // (`packages/core/src/skill.ts` in Kilo-Org/kilocode) does not model
  // `license`, `compatibility`, or `metadata` at all, so it cannot reject any
  // shape rulesync writes for them. Left untyped so rulesync never aborts on
  // a value the underlying tool itself tolerates.
  license: z.optional(z.unknown()),
  compatibility: z.optional(z.unknown()),
  metadata: z.optional(z.unknown()),
  // `allowed-tools` is NOT recognized by Kilo; it is retained for backward
  // compatibility with existing rulesync skill files.
  "allowed-tools": z.optional(z.array(z.string())),
});

export type KiloSkillFrontmatter = z.infer<typeof KiloSkillFrontmatterSchema>;

export type KiloSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: KiloSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

export class KiloSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = KILO_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: KiloSkillParams) {
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

  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    return {
      // Kilo reads skills from `.kilo/skills` for project scope and `~/.kilo/skills`
      // for global scope (same relative path, different base directory).
      relativeDirPath: KILO_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): KiloSkillFrontmatter {
    const result = KiloSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
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
    const result = KiloSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const kiloBlock = {
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
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
      ...(Object.keys(kiloBlock).length > 0 && { kilo: kiloBlock }),
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
  }: ToolSkillFromRulesyncSkillParams): KiloSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const kiloSection = rulesyncFrontmatter.kilo;

    // The Agent Skills standard fields fall back to the root-level rulesync
    // value when the `kilo` section omits them.
    const license = resolveLicense({ rootFrontmatter: rulesyncFrontmatter, section: kiloSection });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: kiloSection,
    });
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: kiloSection,
    });

    const kiloFrontmatter: KiloSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(kiloSection?.["allowed-tools"] !== undefined && {
        "allowed-tools": kiloSection["allowed-tools"],
      }),
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
    };

    const settablePaths = KiloSkill.getSettablePaths({ global });

    return new KiloSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: kiloFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kilo");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<KiloSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: KiloSkill.getSettablePaths,
    });

    const result = KiloSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new KiloSkill({
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
  }: ToolSkillForDeletionParams): KiloSkill {
    return new KiloSkill({
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
