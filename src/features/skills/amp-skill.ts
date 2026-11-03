import { join } from "node:path";

import { z } from "zod/mini";

import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import {
  AMP_GLOBAL_DIR,
  AMP_SKILLS_GLOBAL_DIR,
  AMP_SKILLS_NATIVE_GLOBAL_DIR,
  AMP_SKILLS_PROJECT_DIR,
} from "../../constants/amp-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import type { Logger } from "../../utils/logger.js";
import { parseAmpSettings, resolveAmpSettingsFile } from "../shared/amp-settings.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const AmpSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

/**
 * Amp setting that makes it skip `~/.config/agents/skills/` and
 * `~/.agents/skills/`. https://ampcode.com/docs/cli/settings
 */
const AMP_DISABLE_GLOBAL_AGENTS_SKILLS_KEY = "amp.skills.disableGlobalAgentsSkills";

export type AmpSkillFrontmatter = z.infer<typeof AmpSkillFrontmatterSchema>;

export type AmpSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: AmpSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents an Amp Agent Skill directory.
 *
 * Amp natively reads Agent Skills following the open standard: a directory with a
 * `SKILL.md` carrying `name`/`description` frontmatter, scoped to the project
 * (`.agents/skills/`) and user-wide (`~/.config/agents/skills/`). Global import
 * also reads `~/.agents/skills/` and `~/.config/amp/skills/`, in that order,
 * without managing either discovery root on generation or deletion.
 * @see https://ampcode.com/docs/customize/skills
 */
export class AmpSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = AMP_SKILLS_PROJECT_DIR,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: AmpSkillParams) {
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
      relativeDirPath: global ? AMP_SKILLS_GLOBAL_DIR : AMP_SKILLS_PROJECT_DIR,
      // Amp reads these after the shared .config/agents root. Discover them
      // without taking ownership of their contents on generate --delete.
      ...(global && {
        importOnlySkillRoots: [AGENTSMD_SKILLS_DIR_PATH, AMP_SKILLS_NATIVE_GLOBAL_DIR],
      }),
    };
  }

  /**
   * Warn when the user's Amp settings disable the global agent-agnostic skill
   * roots, because the global skills rulesync writes to
   * `~/.config/agents/skills/` would then never load. Only the user settings
   * file is checked: a workspace `.amp/settings.json(c)` depends on where Amp
   * is started, which global generation cannot know.
   */
  static async getGenerationWarnings({
    outputRoot,
    global,
    logger,
  }: {
    outputRoot: string;
    global: boolean;
    logger: Logger;
  }): Promise<string[]> {
    if (!global) {
      return [];
    }
    const { fileContent, relativeFilePath } = await resolveAmpSettingsFile(
      join(outputRoot, AMP_GLOBAL_DIR),
    );
    if (fileContent === null) {
      return [];
    }
    let settings: Record<string, unknown>;
    try {
      settings = parseAmpSettings({ fileContent });
    } catch (error) {
      logger.debug(
        `Skipping the Amp skills settings check for ${join(AMP_GLOBAL_DIR, relativeFilePath)}: ${formatError(error)}`,
      );
      return [];
    }
    if (settings[AMP_DISABLE_GLOBAL_AGENTS_SKILLS_KEY] !== true) {
      return [];
    }
    return [
      `Amp will not load the global skills rulesync writes to ~/${AMP_SKILLS_GLOBAL_DIR}/: ` +
        `'${AMP_DISABLE_GLOBAL_AGENTS_SKILLS_KEY}' is true in ~/${join(AMP_GLOBAL_DIR, relativeFilePath)}.`,
    ];
  }

  getFrontmatter(): AmpSkillFrontmatter {
    return AmpSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatter(AmpSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    // `name` and `description` have canonical homes; any other key a
    // hand-written SKILL.md carries rides the tool-scoped `amp` section so it
    // survives the round-trip instead of being erased on the next generate.
    const { name, description, ...ampSection } = frontmatter;
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(ampSection).length > 0 && { amp: ampSection }),
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
  }: ToolSkillFromRulesyncSkillParams): AmpSkill {
    const settablePaths = AmpSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const ampFrontmatter: AmpSkillFrontmatter = {
      // The section is written first so the canonical `name`/`description`
      // still own their keys.
      ...rulesyncFrontmatter.amp,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new AmpSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: ampFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("amp");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AmpSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: AmpSkill.getSettablePaths,
    });

    const frontmatter = this.parseLoadedFrontmatter({ schema: AmpSkillFrontmatterSchema, loaded });

    return new AmpSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter,
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
  }: ToolSkillForDeletionParams): AmpSkill {
    return new AmpSkill({
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
