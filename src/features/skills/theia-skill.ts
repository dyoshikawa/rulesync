import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  THEIA_GLOBAL_SKILLS_DIR_PATH,
  THEIA_SKILLS_DIR_PATH,
} from "../../constants/theia-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { quoteForLog } from "../../utils/control-characters.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  collectSkillNameViolations,
  SKILL_DESCRIPTION_MAX_LENGTH,
  warnSkillViolations,
} from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const TheiaSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type TheiaSkillFrontmatter = z.infer<typeof TheiaSkillFrontmatterSchema>;

export type TheiaSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: TheiaSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

const THEIA = "Theia AI";
const THEIA_SKIPS_SKILL = "skips the skill otherwise";

/**
 * The rules Theia AI checks when it loads a skill: `name` must equal the
 * directory name and be lowercase kebab-case, and `description` must be at
 * most 1024 characters. Theia skips a skill that breaks any of them (with a
 * log warning only), so each is reported at generate time. Returned as
 * warnings rather than thrown: the canonical skill is shared with every other
 * target, so a name Theia rejects must not stop the run for the rest.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-core/src/common/skill.ts
 */
function collectTheiaSkillViolations({
  dirName,
  frontmatter,
}: {
  dirName: string;
  frontmatter: TheiaSkillFrontmatter;
}): string[] {
  const { name, description } = frontmatter;
  const violations: string[] = [];

  if (name !== dirName) {
    violations.push(
      `\`name\` ${quoteForLog(name)} must match the directory name ${quoteForLog(dirName)}; ${THEIA} ${THEIA_SKIPS_SKILL}`,
    );
  }
  violations.push(
    ...collectSkillNameViolations({ name, authority: THEIA, consequence: THEIA_SKIPS_SKILL }),
  );
  if (description.length > SKILL_DESCRIPTION_MAX_LENGTH) {
    violations.push(
      `\`description\` is ${description.length} characters; ${THEIA} allows at most ${SKILL_DESCRIPTION_MAX_LENGTH} and ${THEIA_SKIPS_SKILL}`,
    );
  }

  return violations;
}

/**
 * Represents an Eclipse Theia AI skill directory (`<name>/SKILL.md`).
 *
 * Theia AI reads workspace skills from `.prompts/skills/` and the shared Agent
 * Skills root `.agents/skills/`, and user skills from `~/.theia/skills/` and
 * `~/.agents/skills/`. Rulesync writes the shared project root (the same
 * `name` / `description` frontmatter the other `.agents/skills/` writers emit,
 * plus any `theia:` section keys) and the Theia-specific user root.
 *
 * @see https://theia-ide.org/docs/user_ai/#agent-skills
 */
export class TheiaSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = THEIA_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: TheiaSkillParams) {
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

  static getSettablePaths(options?: { global?: boolean }): ToolSkillSettablePaths {
    return {
      relativeDirPath: options?.global ? THEIA_GLOBAL_SKILLS_DIR_PATH : THEIA_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): TheiaSkillFrontmatter {
    return TheiaSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatter(TheiaSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const { name, description, ...rest } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(rest).length > 0 && { theia: rest }),
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
  }

  static fromRulesyncSkill({
    outputRoot = process.cwd(),
    rulesyncSkill,
    validate = true,
    global = false,
    logger,
  }: ToolSkillFromRulesyncSkillParams): TheiaSkill {
    const settablePaths = TheiaSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dirName = rulesyncSkill.getDirName();
    const theiaSection = rulesyncFrontmatter.theia;

    const theiaFrontmatter: TheiaSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(isRecord(theiaSection) && theiaSection),
    };

    warnSkillViolations({
      skillPath: join(outputRoot, settablePaths.relativeDirPath, dirName, SKILL_FILE_NAME),
      violations: collectTheiaSkillViolations({ dirName, frontmatter: theiaFrontmatter }),
      logger,
    });

    return new TheiaSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter: theiaFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  protected static override readonly toolTarget = "theia";

  static async fromDir(params: ToolSkillFromDirParams): Promise<TheiaSkill> {
    return new TheiaSkill(
      await this.loadStandardSkillParams({ params, schema: TheiaSkillFrontmatterSchema }),
    );
  }

  static forDeletion(params: ToolSkillForDeletionParams): TheiaSkill {
    return new TheiaSkill(this.forDeletionParams(params));
  }
}
