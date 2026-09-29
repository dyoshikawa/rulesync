import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { PI_LAYOUT, type PiLayout } from "../../constants/pi-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  resolveCompatibility,
  resolveDisableModelInvocation,
  resolveLicense,
  resolveMetadata,
} from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

/**
 * Frontmatter schema for Pi Coding Agent skills.
 *
 * Pi follows the Agent Skills standard (SKILL.md with `name` and `description`).
 * Additional fields are preserved via `looseObject` so Pi-specific metadata
 * passes through unchanged.
 */
const PiSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Pi implements the Agent Skills spec, which types this as a space-delimited
  // string; the array form stays accepted for existing rulesync inputs.
  // https://agentskills.io/specification
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  "disable-model-invocation": z.optional(z.boolean()),
  license: z.optional(z.string()),
  // The spec types this as a 1-500 character string; the object form stays
  // accepted for back-compat.
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type PiSkillFrontmatter = z.infer<typeof PiSkillFrontmatterSchema>;

export type PiSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: PiSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Skill generator for Pi Coding Agent.
 *
 * - Project scope: `.pi/skills/<name>/SKILL.md`
 * - Global scope: `~/.pi/agent/skills/<name>/SKILL.md`
 */
export class PiSkill extends ToolSkill {
  /** Directory layout; Pi forks (oh-my-pi) override it. */
  protected static readonly layout: PiLayout = PI_LAYOUT;

  constructor({
    outputRoot = process.cwd(),
    relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: PiSkillParams) {
    const resolvedDirPath =
      relativeDirPath ??
      (new.target as typeof PiSkill).getSettablePaths({ global }).relativeDirPath;

    super({
      outputRoot,
      relativeDirPath: resolvedDirPath,
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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(global ? this.layout.globalDir : this.layout.dir, "skills"),
    };
  }

  getFrontmatter(): PiSkillFrontmatter {
    return PiSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = PiSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const allowedToolsArray =
      allowedTools === undefined
        ? undefined
        : Array.isArray(allowedTools)
          ? allowedTools
          : allowedTools.split(/\s+/).filter((tool) => tool.length > 0);
    const piBlock = {
      // Normalized back to the canonical rulesync array, mirroring
      // `DeepagentsSkill`, so a generate → import round trip is stable.
      ...(allowedToolsArray !== undefined &&
        allowedToolsArray.length > 0 && { "allowed-tools": allowedToolsArray }),
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
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
      ...(Object.keys(piBlock).length > 0 && {
        [(this.constructor as typeof PiSkill).layout.toolTarget]: piBlock,
      }),
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
  }: ToolSkillFromRulesyncSkillParams): PiSkill {
    const settablePaths = this.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const piSection = rulesyncFrontmatter[this.layout.toolTarget];
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: piSection,
    });

    // Pi implements the Agent Skills spec, which types `allowed-tools` as a
    // space-delimited string, so a canonical rulesync list is joined rather than
    // emitted as a YAML sequence. Mirrors `DeepagentsSkill`.
    const { "allowed-tools": allowedTools, ...piSectionRest } = piSection ?? {};
    const allowedToolsString = Array.isArray(allowedTools) ? allowedTools.join(" ") : allowedTools;
    // The Agent Skills standard fields fall back to the root-level rulesync
    // value when the `pi` section omits them.
    const license = resolveLicense({ rootFrontmatter: rulesyncFrontmatter, section: piSection });
    const compatibility = resolveCompatibility({
      rootFrontmatter: rulesyncFrontmatter,
      section: piSection,
    });
    const metadata = resolveMetadata({ rootFrontmatter: rulesyncFrontmatter, section: piSection });

    const piFrontmatter: PiSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(allowedToolsString && { "allowed-tools": allowedToolsString }),
      // Spread the section first to carry over any tool-specific keys, then
      // re-apply the resolved values so the root defaults are honored when the
      // section omits a key. Every resolver already prefers a defined section
      // value, so overriding the spread never discards one.
      ...piSectionRest,
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
    };

    return new this({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: piFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes(this.layout.toolTarget);
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<PiSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: (options) => this.getSettablePaths(options),
    });

    const result = PiSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new this({
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
  }: ToolSkillForDeletionParams): PiSkill {
    const settablePaths = this.getSettablePaths({ global });
    return new this({
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
