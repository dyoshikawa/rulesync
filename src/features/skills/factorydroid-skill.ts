import { join } from "node:path";

import { z } from "zod/mini";

import {
  FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME,
  FACTORYDROID_SKILLS_DIR_PATH,
} from "../../constants/factorydroid-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveDisableModelInvocation, resolveUserInvocable } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// looseObject preserves unknown keys during parsing (like passthrough in Zod 3).
// Factory Droid skills are native SKILL.md files with frontmatter.
// See https://docs.factory.ai/cli/configuration/skills
//   - `name`, `description`: identity fields.
//   - `user-invocable`, `disable-model-invocation`: optional behavior flags,
//     passed through verbatim when present.
//   - `enabled`: defaults to true; set to false to keep the skill on disk but
//     disable it.
//   - `allowed-tools`: declares the tools the skill is designed to use. (The
//     older `tools` spelling is deprecated upstream.)
//   - `license`, `compatibility`, `metadata`, `version`: packaging metadata for
//     skills shared through catalogs, plugins, or team tooling. Droid documents
//     them without a type and never validates them, so they are declared for
//     discoverability and carried through as-is (up to YAML's own scalar
//     normalization) rather than type-constrained:
//     rejecting a value Droid accepts (a YAML list `compatibility`, an unquoted
//     `version: 2026-01-01` that js-yaml parses as a Date) would break the
//     import of a working SKILL.md.
export const FactorydroidSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "user-invocable": z.optional(z.boolean()),
  "disable-model-invocation": z.optional(z.boolean()),
  enabled: z.optional(z.boolean()),
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  license: z.optional(z.unknown()),
  compatibility: z.optional(z.unknown()),
  metadata: z.optional(z.unknown()),
  version: z.optional(z.unknown()),
});

export type FactorydroidSkillFrontmatter = z.infer<typeof FactorydroidSkillFrontmatterSchema>;

export type FactorydroidSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: FactorydroidSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Factory Droid skill directory.
 * Factory Droid has native skill support — it reads .factory/skills/ directories
 * with SKILL.md files. See https://docs.factory.ai/cli/configuration/skills
 *
 * Supports both project mode (.factory/skills/) and global mode (~/.factory/skills/).
 */
export class FactorydroidSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = FactorydroidSkill.getSettablePaths().relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: FactorydroidSkillParams) {
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
    // Factory Droid skills use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.factory/skills/
    // - Global mode: {getHomeDirectory()}/.factory/skills/
    return {
      relativeDirPath: FACTORYDROID_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): FactorydroidSkillFrontmatter {
    const result = FactorydroidSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = FactorydroidSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // `name` and `description` have canonical homes; every other key — the
    // documented Droid fields including the packaging metadata, plus anything
    // beyond the schema a hand-written SKILL.md carries — rides the tool-scoped
    // `factorydroid` section so it survives the round trip instead of being
    // erased by the next generate.
    const { name, description, ...factorydroidBlock } = frontmatter;
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(factorydroidBlock).length > 0 && { factorydroid: factorydroidBlock }),
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
  }: ToolSkillFromRulesyncSkillParams): FactorydroidSkill {
    const settablePaths = FactorydroidSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const factorydroidSection = rulesyncFrontmatter.factorydroid;
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: factorydroidSection,
    });
    const resolvedUserInvocable = resolveUserInvocable({
      rootFrontmatter: rulesyncFrontmatter,
      section: factorydroidSection,
    });

    // A `name`/`description` that somehow rode along in the section is dropped
    // so the canonical values keep owning those keys, which also lets them stay
    // first in the emitted frontmatter instead of trailing the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...section
    } = factorydroidSection ?? {};
    const factorydroidFrontmatter: FactorydroidSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...section,
      // Both resolvers already prefer a defined section value over the root
      // default, so overriding the spread with them never discards one.
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
      ...(resolvedUserInvocable !== undefined && {
        "user-invocable": resolvedUserInvocable,
      }),
    };

    return new FactorydroidSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: factorydroidFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("factorydroid");
  }

  /**
   * Whether a directory in `.factory/skills/` belongs to the skills feature.
   *
   * `review-guidelines/` never does. The checks feature writes Factory's
   * review guidelines there (see `FactorydroidCheck`), because Factory's
   * automated reviewer reads that exact path, so the path has a single owner in
   * both directions: the skills feature neither deletes the directory as an
   * orphan on `generate --delete` nor imports it as a skill. Ownership cannot
   * be decided from the file's shape instead — Factory's own documented example
   * has no frontmatter, so a hand-authored `review-guidelines` is
   * indistinguishable from a generated one until it is too late to put it back.
   *
   * `rulesync import --targets factorydroid --features checks` is what reads a
   * hand-authored file at this path.
   */
  static async isDirOwned({
    dirName,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    // Accepted for interface parity with tools whose ownership hook consults
    // the generated tree or `.rulesync/` sources; the path alone decides here.
    inputRoots: readonly string[];
  }): Promise<boolean> {
    return dirName !== FACTORYDROID_REVIEW_GUIDELINES_DIR_NAME;
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<FactorydroidSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: FactorydroidSkill.getSettablePaths,
    });

    const result = FactorydroidSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new FactorydroidSkill({
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
  }: ToolSkillForDeletionParams): FactorydroidSkill {
    const settablePaths = FactorydroidSkill.getSettablePaths({ global });
    return new FactorydroidSkill({
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
