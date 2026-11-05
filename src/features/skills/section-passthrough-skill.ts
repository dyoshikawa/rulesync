import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
} from "./tool-skill.js";

const SectionPassthroughSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

type SectionPassthroughSkillFrontmatter = z.infer<typeof SectionPassthroughSkillFrontmatterSchema>;

/** The rulesync frontmatter sections a pass-through skill can own. */
type SectionPassthroughSectionKey = "bob" | "cline" | "continue" | "cortexcode" | "roo" | "tabnine";

export type SectionPassthroughSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: SectionPassthroughSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Shared implementation for skill formats whose `SKILL.md` frontmatter is
 * `name` (matching the directory name) and `description`, with every other key
 * carried in the tool's own rulesync section.
 *
 * On import, keys beyond `name`/`description` are lifted into the section so
 * they survive the round-trip; on generate, the section is spread back with the
 * canonical `name`/`description` winning over a stray same-named key in it.
 *
 * Each concrete subclass supplies its paths (`getSettablePaths`), its target
 * (`toolTarget`) and its section (`sectionKey`), and may narrow the frontmatter
 * schema (`frontmatterSchema`).
 */
export class SectionPassthroughSkill extends ToolSkill {
  /** The rulesync frontmatter section that carries the tool-specific keys. */
  protected static readonly sectionKey: SectionPassthroughSectionKey | undefined = undefined;

  protected static readonly frontmatterSchema: z.ZodMiniType<SectionPassthroughSkillFrontmatter> =
    SectionPassthroughSkillFrontmatterSchema;

  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = new.target.getSettablePaths().relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: SectionPassthroughSkillParams) {
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

  protected static getSectionKey(): SectionPassthroughSectionKey {
    if (this.sectionKey === undefined) {
      throw new Error("Please implement this method in the subclass.");
    }
    return this.sectionKey;
  }

  getFrontmatter(): SectionPassthroughSkillFrontmatter {
    return this.getClass().frontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatterAndDirName(this.getClass().frontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const { name, description, ...section } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(section).length > 0 && { [this.getClass().getSectionKey()]: section }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): SectionPassthroughSkill {
    const settablePaths = this.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const {
      name: _sectionName,
      description: _sectionDescription,
      ...section
    } = rulesyncFrontmatter[this.getSectionKey()] ?? {};
    const frontmatter: SectionPassthroughSkillFrontmatter = {
      ...section,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new this({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: frontmatter.name,
      frontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<SectionPassthroughSkill> {
    return new this(
      await this.loadStandardSkillParamsMatchingDirName({
        params,
        schema: this.frontmatterSchema,
      }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): SectionPassthroughSkill {
    return new this(this.forDeletionParams(params));
  }

  private getClass(): typeof SectionPassthroughSkill {
    return this.constructor as typeof SectionPassthroughSkill;
  }
}
