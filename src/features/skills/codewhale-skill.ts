import { join } from "node:path";

import { z } from "zod/mini";

import { CODEWHALE_SKILLS_DIR_PATH } from "../../constants/codewhale-paths.js";
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

// Codewhale skill frontmatter: `name` and `description` as in the Agent Skills
// spec. Codewhale-specific routing keys (`invocation`, `aliases-for`,
// `description_<tag>`) pass through the `codewhale` section.
// @see https://github.com/Hmbown/Codewhale/blob/main/docs/SKILLS.md
const CodewhaleSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type CodewhaleSkillFrontmatter = z.infer<typeof CodewhaleSkillFrontmatterSchema>;

export type CodewhaleSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: CodewhaleSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Codewhale skill directory.
 *
 * Codewhale discovers `<name>/SKILL.md` directories under
 * `<workspace>/.codewhale/skills/` (project scope) and `~/.codewhale/skills/`
 * (user scope); supporting files next to `SKILL.md` are carried along.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/SKILLS.md
 */
export class CodewhaleSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = CODEWHALE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: CodewhaleSkillParams) {
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
    // The same relative path serves both scopes; the processor supplies the
    // home directory as outputRoot in global mode (`~/.codewhale/skills`).
    return {
      relativeDirPath: CODEWHALE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): CodewhaleSkillFrontmatter {
    const result = CodewhaleSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = CodewhaleSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    // Everything beyond `name` / `description` (the documented routing keys and
    // any key a hand-written SKILL.md carries) is lifted into the `codewhale`
    // section so it survives the round-trip (mirrors roo-skill.ts).
    const { name, description, ...codewhaleSection } = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name,
      description,
      targets: ["*"],
      ...(Object.keys(codewhaleSection).length > 0 && { codewhale: codewhaleSection }),
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
  }: ToolSkillFromRulesyncSkillParams): CodewhaleSkill {
    const settablePaths = CodewhaleSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // The `codewhale` section carries Codewhale-specific frontmatter; canonical
    // name/description always win over a stray same-named key in the section.
    const {
      name: _sectionName,
      description: _sectionDescription,
      ...codewhaleSection
    } = rulesyncFrontmatter.codewhale ?? {};
    const codewhaleFrontmatter: CodewhaleSkillFrontmatter = {
      ...codewhaleSection,
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new CodewhaleSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: codewhaleFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("codewhale");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<CodewhaleSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: CodewhaleSkill.getSettablePaths,
    });

    const result = CodewhaleSkillFrontmatterSchema.safeParse(loaded.frontmatter);
    if (!result.success) {
      const skillDirPath = join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName);
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, SKILL_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    return new CodewhaleSkill({
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
  }: ToolSkillForDeletionParams): CodewhaleSkill {
    return new CodewhaleSkill({
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
