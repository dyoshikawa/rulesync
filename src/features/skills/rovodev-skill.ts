import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  ROVODEV_AGENTS_SKILLS_DIR_PATH,
  ROVODEV_SKILLS_DIR_PATH,
} from "../../constants/rovodev-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { pickStandardSkillFields, resolveStandardSkillFields } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const RovodevSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Optional Agent Skills frontmatter that Rovo Dev documents besides name/description.
  // `allowed-tools` is a space-separated string upstream; a YAML list is also accepted.
  // https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills/
  "allowed-tools": z.optional(z.union([z.string(), z.array(z.string())])),
  license: z.optional(z.string()),
  // The Agent Skills spec defines `compatibility` as a free-form string
  // (1–500 chars); the object form stays accepted for back-compat.
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type RovodevSkillFrontmatter = z.infer<typeof RovodevSkillFrontmatterSchema>;

export type RovodevSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: RovodevSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Rovo Dev CLI Agent Skills: one directory per skill with `SKILL.md` (Agent Skills protocol).
 *
 * - **Project:** `.rovodev/skills/<skill-name>/` (canonical sync target) or `.agents/skills/<skill-name>/`
 * - **User:** `~/.rovodev/skills/<skill-name>/` or `~/.agents/skills/<skill-name>/` (same relative paths under home in global mode)
 *
 * Import scans `.rovodev/skills` first, then `.agents/skills`. Generation writes only under `.rovodev/skills`.
 *
 * @see https://support.atlassian.com/rovo/docs/extend-rovo-dev-cli-with-agent-skills/
 */
export class RovodevSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = ROVODEV_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: RovodevSkillParams) {
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
      relativeDirPath: ROVODEV_SKILLS_DIR_PATH,
      alternativeSkillRoots: [ROVODEV_AGENTS_SKILLS_DIR_PATH],
    };
  }

  getFrontmatter(): RovodevSkillFrontmatter {
    const result = RovodevSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatterAndDirName(RovodevSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const rovodevSection = {
      ...(frontmatter["allowed-tools"] !== undefined && {
        "allowed-tools": frontmatter["allowed-tools"],
      }),
      ...pickStandardSkillFields(frontmatter),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(rovodevSection).length > 0 && { rovodev: rovodevSection }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): RovodevSkill {
    const settablePaths = RovodevSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const rovodevSection = rulesyncFrontmatter.rovodev;
    // The Agent Skills standard fields fall back to the root-level rulesync
    // value when the `rovodev` section omits them.

    const rovodevFrontmatter: RovodevSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(rovodevSection?.["allowed-tools"] !== undefined && {
        "allowed-tools": rovodevSection["allowed-tools"],
      }),
      ...resolveStandardSkillFields({
        rootFrontmatter: rulesyncFrontmatter,
        section: rovodevSection,
      }),
    };

    return new RovodevSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rovodevFrontmatter.name,
      frontmatter: rovodevFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "rovodev";

  static async fromDir(params: ToolSkillFromDirParams): Promise<RovodevSkill> {
    return new RovodevSkill(
      await this.loadStandardSkillParamsMatchingDirName({
        params,
        schema: RovodevSkillFrontmatterSchema,
      }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): RovodevSkill {
    return new RovodevSkill(this.forDeletionParams(params));
  }
}
