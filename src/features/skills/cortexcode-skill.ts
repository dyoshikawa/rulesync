import { join } from "node:path";

import { z } from "zod/mini";

import {
  CORTEXCODE_GLOBAL_SKILLS_DIR_PATH,
  CORTEXCODE_SKILLS_DIR_PATH,
} from "../../constants/cortexcode-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

// Snowflake Cortex Code skill frontmatter: `name` and `description` as in the
// Agent Skills spec, plus an optional `tools` allowlist.
// @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
const CortexcodeSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
  /** Tool names the skill may use; omitted = every tool. */
  tools: z.optional(z.array(z.string())),
});

export type CortexcodeSkillFrontmatter = z.infer<typeof CortexcodeSkillFrontmatterSchema>;

export type CortexcodeSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CortexcodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Snowflake Cortex Code skill directory.
 *
 * Cortex Code discovers Anthropic-style `<name>/SKILL.md` directories under
 * `<project>/.cortex/skills/` (project scope) and `~/.snowflake/cortex/skills/`
 * (user scope). The frontmatter requires `name` (matching the directory name)
 * and `description`; supporting files next to `SKILL.md` are carried along.
 *
 * @see https://docs.snowflake.com/en/user-guide/cortex-code/extensibility
 */
export class CortexcodeSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CORTEXCODE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CortexcodeSkillParams) {
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
    // The processor supplies the home directory as outputRoot in global mode:
    // - Project mode: {process.cwd()}/.cortex/skills/
    // - Global mode: {getHomeDirectory()}/.snowflake/cortex/skills/
    return {
      relativeDirPath: global ? CORTEXCODE_GLOBAL_SKILLS_DIR_PATH : CORTEXCODE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CortexcodeSkillFrontmatter {
    const result = CortexcodeSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
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

    const result = CortexcodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }

    if (result.data.name !== this.getDirName()) {
      return {
        success: false,
        error: new Error(
          `${this.getDirPath()}: frontmatter name (${result.data.name}) must match directory name (${this.getDirName()})`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    // Everything beyond `name` / `description` (the documented `tools` list and
    // any key a hand-written SKILL.md carries) is lifted into the `cortexcode`
    // section so it survives the round-trip (mirrors roo-skill.ts).
    const { name, description, ...cortexcodeSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(cortexcodeSection).length > 0 && { cortexcode: cortexcodeSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CortexcodeSkill {
    const settablePaths = CortexcodeSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `cortexcode` section carries Cortex-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...cortexcodeSection
    } = rulesyncFrontmatter.cortexcode ?? {};
    const cortexcodeFrontmatter: CortexcodeSkillFrontmatter = {
      ...cortexcodeSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new CortexcodeSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: cortexcodeFrontmatter.name,
      frontmatter: cortexcodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("cortexcode");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CortexcodeSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CortexcodeSkill.getSettablePaths,
    });

    const result = CortexcodeSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    if (result.data.name !== loaded.dirName) {
      const skillFilePath = join(
        loaded.outputRoot,
        loaded.relativeDirPath,
        loaded.dirName,
        SKILL_FILE_NAME,
      );
      throw new Error(
        `Frontmatter name (${result.data.name}) must match directory name (${loaded.dirName}) in ${skillFilePath}`,
      );
    }

    return new CortexcodeSkill({
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
  }: ToolSkillForDeletionParams): CortexcodeSkill {
    return new CortexcodeSkill({
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
