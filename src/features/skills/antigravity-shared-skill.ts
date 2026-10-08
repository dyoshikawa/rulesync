import { join } from "node:path";

import {
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_SKILLS_DIR_PATH,
} from "../../constants/antigravity-cli-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { isRecord } from "../../utils/type-guards.js";
import { antigravityCommandSkillNameExists } from "../commands/antigravity-command-skill-name.js";
import {
  AntigravitySkillFrontmatter,
  AntigravitySkillFrontmatterSchema,
} from "./antigravity-skill.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import { resolveMetadata } from "./skills-utils.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export type AntigravitySharedSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: AntigravitySkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Shared skill directory implementation for Google Antigravity 2.0, used by
 * both the IDE and the CLI.
 *
 * Both targets default to the new plural `.agents/skills/` directory (project
 * scope) and share the same `SKILL.md` frontmatter. They differ only in their
 * global skills tree (`~/.gemini/<subdir>/skills/`) and which rulesync target
 * name they answer to; each concrete subclass supplies those via
 * {@link AntigravitySharedSkill.getGlobalSubdir} and
 * {@link AntigravitySharedSkill.getToolTarget}.
 *
 * Frontmatter beyond `name`/`description` (e.g. `disable-slash-command`,
 * `metadata`) comes from the rulesync section named after that target, with the
 * root-level `user-invocable` / `metadata` as defaults. On the shared project
 * `.agents/skills/` tree both targets merge the `antigravity-ide` and
 * `antigravity-cli` sections so their output never diverges.
 */
export class AntigravitySharedSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = ANTIGRAVITY_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: AntigravitySharedSkillParams) {
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

  /** Global skills subdirectory under `~/.gemini/` (`antigravity` | `antigravity-cli`). */
  protected static getGlobalSubdir(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  /** The rulesync target name this skill answers to. */
  protected static getToolTarget(): ToolTarget {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({
    global = false,
  }: {
    global?: boolean;
  } = {}): ToolSkillSettablePaths {
    // - Project mode: {process.cwd()}/.agents/skills/
    // - Global mode: {getHomeDirectory()}/.gemini/<subdir>/skills/
    if (global) {
      return {
        relativeDirPath: join(ANTIGRAVITY_GEMINI_DIR, this.getGlobalSubdir(), "skills"),
      };
    }
    return {
      relativeDirPath: ANTIGRAVITY_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): AntigravitySkillFrontmatter {
    const result = AntigravitySkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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
    const result = AntigravitySkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const { name, description, ...antigravityFields } = this.getFrontmatter();
    // Every key beyond `name`/`description` (e.g. `disable-slash-command`,
    // `metadata`) is kept under the target's own section so the next generate
    // writes it back unchanged.
    const sectionKey = (this.constructor as typeof AntigravitySharedSkill).getToolTarget();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(antigravityFields).length > 0 && { [sectionKey]: antigravityFields }),
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
  }: ToolSkillFromRulesyncSkillParams): AntigravitySharedSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const settablePaths = this.getSettablePaths({ global });
    // The IDE and the CLI write the same project `.agents/skills/` tree, so
    // there both read the two sections (CLI keys win) and emit identical files
    // whichever target runs last. Any other tree reads only the own section.
    const sectionKeys: ToolTarget[] =
      !global && settablePaths.relativeDirPath === ANTIGRAVITY_SKILLS_DIR_PATH
        ? ["antigravity-ide", "antigravity-cli"]
        : [this.getToolTarget()];
    const section: Record<string, unknown> = {};
    for (const key of sectionKeys) {
      const rawSection = rulesyncFrontmatter[key];
      if (isRecord(rawSection)) Object.assign(section, rawSection);
    }
    const { name: _name, description: _description, ...sectionFields } = section;

    // `disable-slash-command: true` hides the skill from the `/` menu while
    // keeping it model-invocable (Antigravity CLI 1.1.12), which is what the
    // shared root-level `user-invocable: false` means; a section value wins.
    const sectionDisableSlashCommand = sectionFields["disable-slash-command"];
    const disableSlashCommand =
      typeof sectionDisableSlashCommand === "boolean"
        ? sectionDisableSlashCommand
        : rulesyncFrontmatter["user-invocable"] === false
          ? true
          : undefined;
    const metadata = resolveMetadata({
      rootFrontmatter: rulesyncFrontmatter,
      section: sectionFields,
    });

    const antigravityFrontmatter: AntigravitySkillFrontmatter = {
      // The section is written first so the canonical `name`/`description` and
      // the resolved fields still own their keys.
      ...sectionFields,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(disableSlashCommand !== undefined && { "disable-slash-command": disableSlashCommand }),
      ...(metadata !== undefined && { metadata }),
    };

    return new this({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: antigravityFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes(this.getToolTarget());
  }

  /**
   * Commands are emitted into this same skills tree as `<name>/SKILL.md` (see
   * `AntigravitySharedCommand`), so a directory matching a command the
   * commands feature emits is owned by that feature: it must not be imported
   * as a skill nor deleted as an orphan skill. The project tree is shared by
   * the IDE and the CLI, so a command for either target owns it there.
   */
  static async isDirOwned({
    relativeDirPath,
    dirName,
    inputRoots,
    global,
  }: {
    outputRoot: string;
    relativeDirPath: string;
    dirName: string;
    inputRoots: readonly string[];
    global: boolean;
  }): Promise<boolean> {
    if (relativeDirPath !== this.getSettablePaths({ global }).relativeDirPath) {
      return true;
    }
    const toolTargets: ToolTarget[] = global
      ? [this.getToolTarget()]
      : ["antigravity-ide", "antigravity-cli"];
    return !(await antigravityCommandSkillNameExists({ inputRoots, dirName, toolTargets }));
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<AntigravitySharedSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: (options) => this.getSettablePaths(options),
    });

    const result = AntigravitySkillFrontmatterSchema.safeParse(loaded.frontmatter);
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
  }: ToolSkillForDeletionParams): AntigravitySharedSkill {
    return new this({
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
