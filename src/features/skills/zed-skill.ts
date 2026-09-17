import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ZED_SKILLS_DIR_PATH } from "../../constants/zed-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { toPosixPath } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveDisableModelInvocation } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const ZedSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  "disable-model-invocation": z.optional(z.boolean()),
});

export type ZedSkillFrontmatter = z.infer<typeof ZedSkillFrontmatterSchema>;

// Limits Zed applies when it loads a skill. A `name` outside these rules makes
// the skill "fail to load and surface an error in the UI"; a `description`
// past the limit still loads, "but with a warning". Both are reported at
// generate time so the author hears about them before opening Zed. The 50KB
// cap on the catalog as a whole spans every installed skill, which a single
// skill cannot judge, so it is not checked here.
// https://zed.dev/docs/ai/skills
const ZED_SKILL_NAME_MAX_LENGTH = 64;
const ZED_SKILL_DESCRIPTION_MAX_LENGTH = 1024;
// "Lowercase letters, numbers, and hyphens only", not starting or ending with
// a hyphen and with no consecutive hyphens — alphanumeric runs joined by
// single hyphens.
const ZED_SKILL_NAME_PATTERN = /^[a-z0-9]+(?:-[a-z0-9]+)*$/;

/**
 * Collect the rules Zed enforces on a skill's frontmatter that the loose
 * schema above does not, in the order Zed's docs list them. Returned as
 * warnings rather than thrown: the canonical skill is shared with every other
 * target, so a name Zed rejects must not stop the generate run for the rest.
 */
function collectZedSkillViolations({
  name,
  description,
}: {
  name: string;
  description: string;
}): string[] {
  const violations: string[] = [];

  if (name.length === 0) {
    violations.push("`name` must not be empty; Zed does not load a skill without one");
  } else {
    if (name.length > ZED_SKILL_NAME_MAX_LENGTH) {
      violations.push(
        `\`name\` is ${name.length} characters; Zed allows at most ${ZED_SKILL_NAME_MAX_LENGTH} and does not load the skill otherwise`,
      );
    }
    if (!ZED_SKILL_NAME_PATTERN.test(name)) {
      violations.push(
        `\`name\` "${name}" must contain only lowercase letters, digits and single hyphens, with no leading, trailing or consecutive hyphens; Zed does not load the skill otherwise`,
      );
    }
  }

  if (description.length > ZED_SKILL_DESCRIPTION_MAX_LENGTH) {
    violations.push(
      `\`description\` is ${description.length} characters; Zed loads the skill but warns past ${ZED_SKILL_DESCRIPTION_MAX_LENGTH}`,
    );
  }

  return violations;
}

export type ZedSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ZedSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Zed agent skill directory.
 * Skills are stored under .agents/skills/ (project) or ~/.agents/skills/ (global)
 * with SKILL.md files.
 */
export class ZedSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = ZED_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ZedSkillParams) {
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
    // Zed skills use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.agents/skills/
    // - Global mode: {getHomeDirectory()}/.agents/skills/
    return {
      relativeDirPath: ZED_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): ZedSkillFrontmatter {
    return ZedSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = ZedSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const zedBlock = {
      ...(frontmatter["disable-model-invocation"] !== undefined && {
        "disable-model-invocation": frontmatter["disable-model-invocation"],
      }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(zedBlock).length > 0 && { zed: zedBlock }),
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
  }: ToolSkillFromRulesyncSkillParams): ZedSkill {
    const settablePaths = ZedSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const dirName = rulesyncSkill.getDirName();
    const zedSection = rulesyncFrontmatter.zed;
    const resolvedDisableModelInvocation = resolveDisableModelInvocation({
      rootFrontmatter: rulesyncFrontmatter,
      section: zedSection,
    });

    const zedFrontmatter: ZedSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      // Spread the section first to carry over any tool-specific keys, then
      // re-apply the resolved `disable-model-invocation` so the root default is
      // honored when the section omits the key.
      ...zedSection,
      ...(resolvedDisableModelInvocation !== undefined && {
        "disable-model-invocation": resolvedDisableModelInvocation,
      }),
    };

    ZedSkill.reportSkillViolations({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter: zedFrontmatter,
      logger,
    });

    return new ZedSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName,
      frontmatter: zedFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  /**
   * Warn about every rule Zed enforces on the skill about to be written. The
   * reported path includes `outputRoot` so a global-scope skill points at the
   * file under the home directory rather than a same-named project path.
   */
  static reportSkillViolations({
    outputRoot,
    relativeDirPath,
    dirName,
    frontmatter,
    logger,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    frontmatter: ZedSkillFrontmatter;
    logger?: Logger;
  }): void {
    const skillPath = join(outputRoot, relativeDirPath, dirName, SKILL_FILE_NAME);
    for (const violation of collectZedSkillViolations(frontmatter)) {
      warnWithFallback(logger, `${stripControlCharacters(toPosixPath(skillPath))}: ${violation}`);
    }
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("zed");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<ZedSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: ZedSkill.getSettablePaths,
    });

    const result = ZedSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new ZedSkill({
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
  }: ToolSkillForDeletionParams): ZedSkill {
    const settablePaths = ZedSkill.getSettablePaths({ global });
    return new ZedSkill({
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
