import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import {
  MUSECODE_GLOBAL_SKILLS_DIR_PATH,
  MUSECODE_SKILLS_DIR_PATH,
} from "../../constants/musecode-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { toSpecConformantAgentSkillFields } from "./agentsskills-skill.js";
import {
  RulesyncSkill,
  RulesyncSkillFrontmatter,
  RulesyncSkillFrontmatterInput,
  SkillFile,
} from "./rulesync-skill.js";
import { resolveCompatibility, resolveLicense, resolveMetadata } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const MusecodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  // Agent Skills packaging fields Muse Code reads: `skills inspect` reports
  // `license` (1.4.0) and `metadata.display-name` names the skill in the
  // transcript and `/skills` (1.4.7).
  // https://dev.meta.ai/docs/muse-code/changelog
  license: z.optional(z.string()),
  compatibility: z.optional(z.union([z.string(), z.looseObject({})])),
  metadata: z.optional(z.looseObject({})),
});

export type MusecodeSkillFrontmatter = z.infer<typeof MusecodeSkillFrontmatterSchema>;

export type MusecodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: MusecodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Build the Muse Code frontmatter. `license`, `compatibility` and `metadata`
 * come from the `musecode` section with the root-level values as fallback, and
 * are normalized exactly as the `agentsskills` writer normalizes them: at
 * project scope both targets write the same `.agents/skills/<name>/SKILL.md`,
 * so for a skill without per-target overrides the file no longer depends on
 * which of the two runs last.
 */
function buildMusecodeFrontmatter(
  rulesyncFrontmatter: RulesyncSkillFrontmatter,
): MusecodeSkillFrontmatter {
  const section = rulesyncFrontmatter.musecode;
  const license = resolveLicense({ rootFrontmatter: rulesyncFrontmatter, section });
  const compatibility = resolveCompatibility({ rootFrontmatter: rulesyncFrontmatter, section });
  const metadata = resolveMetadata({ rootFrontmatter: rulesyncFrontmatter, section });

  return {
    name: rulesyncFrontmatter.name,
    description: rulesyncFrontmatter.description,
    ...toSpecConformantAgentSkillFields({
      ...(license !== undefined && { license }),
      ...(compatibility !== undefined && { compatibility }),
      ...(metadata !== undefined && { metadata }),
    }),
  };
}

/**
 * Represents a Meta Muse Code skill directory.
 *
 * Muse Code reads Agent Skills as `<skill-id>/SKILL.md` directories from the
 * project (`.agents/skills/`) and from the user config
 * (`$XDG_CONFIG_HOME/muse/skills`, plus `~/.agents/skills`). rulesync emits the
 * project directory and, at global scope, only the XDG-default
 * `~/.config/muse/skills` so a skill is written exactly once. Muse Code's
 * compat scans of repo-local `.codex/skills` and `.claude/skills` belong to
 * other tools and are not emitted.
 * @see https://dev.meta.ai/docs/muse-code/extending.md
 */
export class MusecodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = MUSECODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: MusecodeSkillParams) {
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
      relativeDirPath: global ? MUSECODE_GLOBAL_SKILLS_DIR_PATH : MUSECODE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): MusecodeSkillFrontmatter {
    return MusecodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = MusecodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const musecodeSection = {
      ...(frontmatter.license !== undefined && { license: frontmatter.license }),
      ...(frontmatter.compatibility !== undefined && { compatibility: frontmatter.compatibility }),
      ...(frontmatter.metadata !== undefined && { metadata: frontmatter.metadata }),
    };
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      ...(Object.keys(musecodeSection).length > 0 && { musecode: musecodeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): MusecodeSkill {
    const settablePaths = MusecodeSkill.getSettablePaths({ global });
    const musecodeFrontmatter = buildMusecodeFrontmatter(rulesyncSkill.getFrontmatter());

    return new MusecodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: musecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("musecode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<MusecodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: MusecodeSkill.getSettablePaths,
    });

    const result = MusecodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new MusecodeSkill({
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
  }: ToolSkillForDeletionParams): MusecodeSkill {
    const settablePaths = MusecodeSkill.getSettablePaths({ global });
    return new MusecodeSkill({
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
