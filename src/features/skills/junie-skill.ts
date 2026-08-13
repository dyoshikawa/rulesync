import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { JUNIE_SKILLS_DIR_PATH } from "../../constants/junie-paths.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const JunieSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type JunieSkillFrontmatter = z.infer<typeof JunieSkillFrontmatterSchema>;

export type JunieSkillParams = {
  outputRoot?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: JunieSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/** An ATX markdown heading line (`#` … `######`). */
const HEADING_LINE = /^#{1,6}(\s|$)/;

/**
 * Junie's own fallback for a `SKILL.md` with no `description`: "If
 * `description` is not provided in the frontmatter, Junie CLI extracts the
 * first paragraph of the body content as the description." Headings do not
 * count as that paragraph — "If the body is also empty or contains only
 * headings, the skill will fail to load."
 *
 * This is import-only. The canonical `RulesyncSkillFrontmatter` requires a
 * description, so without the fallback a skill Junie itself loads fine aborts
 * the whole import; generation keeps emitting an explicit description, which
 * the same docs recommend.
 *
 * Heading lines are therefore skipped rather than taken: a body opening with
 * `# Skill Name` would otherwise import that title as the description and —
 * because the next generate writes it out explicitly — replace Junie's own
 * correct fallback with the wrong value everywhere, canonical config included.
 *
 * A paragraph runs to the first blank line or heading, and is collapsed onto
 * one line because it becomes a YAML frontmatter value. A fenced code block is
 * not treated specially: it is ordinary content, so a body whose first
 * paragraph is a fence yields the fence text. Returns an empty string when the
 * body holds no such paragraph, which the caller turns into a skipped skill.
 *
 * @see https://junie.jetbrains.com/docs/agent-skills.html
 */
function deriveDescriptionFromBody(body: string): string {
  const paragraph: string[] = [];
  for (const rawLine of body.split(/\r?\n/)) {
    const line = rawLine.trim();
    if (paragraph.length === 0) {
      // Still looking for the paragraph: blank lines and headings are skipped.
      if (line === "" || HEADING_LINE.test(line)) continue;
      paragraph.push(line);
      continue;
    }
    // Inside the paragraph: a blank line or a heading ends it.
    if (line === "" || HEADING_LINE.test(line)) break;
    paragraph.push(line);
  }
  return paragraph.join(" ").trim();
}

/**
 * Represents a JetBrains Junie skill directory.
 * Skills are stored under the .junie/skills directory with SKILL.md files.
 */
export class JunieSkill extends ToolSkill {
  constructor({
    outputRoot = process.cwd(),
    relativeDirPath = JUNIE_SKILLS_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: JunieSkillParams) {
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
    // Junie skills use the same relative path for both project and global modes.
    // The actual location differs based on outputRoot:
    // - Project mode: {process.cwd()}/.junie/skills/
    // - Global mode: {getHomeDirectory()}/.junie/skills/
    return {
      relativeDirPath: JUNIE_SKILLS_DIR_PATH,
    };
  }

  getFrontmatter(): JunieSkillFrontmatter {
    const result = JunieSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
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

    const result = JunieSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
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
  }: ToolSkillFromRulesyncSkillParams): JunieSkill {
    const settablePaths = JunieSkill.getSettablePaths({ global });
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const junieFrontmatter: JunieSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return new JunieSkill({
      outputRoot,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: junieFrontmatter.name,
      frontmatter: junieFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("junie");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<JunieSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: JunieSkill.getSettablePaths,
    });

    // `description` is optional upstream, so it is filled in from the body
    // before validation rather than failing a skill Junie loads fine.
    let frontmatter = loaded.frontmatter;
    if (isRecord(frontmatter) && frontmatter.description === undefined) {
      const derived = deriveDescriptionFromBody(loaded.body);
      if (derived === "") {
        // Junie says such a skill "will fail to load", so there is nothing to
        // import. Throwing here — with `lenientImport` set for this target —
        // skips this one skill rather than the whole run.
        throw new Error(
          `Cannot import ${join(loaded.outputRoot, loaded.relativeDirPath, loaded.dirName, SKILL_FILE_NAME)}: ` +
            `it has no description and its body has no paragraph to derive one from, so Junie ` +
            `cannot load it either. Add a description to the frontmatter.`,
        );
      }
      frontmatter = { ...frontmatter, description: derived };
    }

    const result = JunieSkillFrontmatterSchema.safeParse(frontmatter);
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

    return new JunieSkill({
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
  }: ToolSkillForDeletionParams): JunieSkill {
    const settablePaths = JunieSkill.getSettablePaths({ global });
    return new JunieSkill({
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
