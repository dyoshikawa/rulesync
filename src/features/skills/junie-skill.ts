import { join } from "node:path";

import { z } from "zod/mini";

import { AGENTSMD_SKILLS_DIR_PATH } from "../../constants/agentsmd-paths.js";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { JUNIE_SKILLS_DIR_PATH } from "../../constants/junie-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { firstNonHeadingParagraph } from "../../utils/markdown-paragraph.js";
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
    //
    // Junie CLI additionally loads skills from the cross-tool Agent Skills root
    // at `<projectRoot>/.agents/skills/` and `~/.agents/skills/`. That root is
    // import-only: rulesync never writes there for this target, so a skill
    // another tool put in the shared tree must not become an orphan deletion
    // candidate — least of all under the user's home directory. When the same
    // skill name exists in both roots, the Junie-specific root wins.
    // This mirrors how `.agents/` is already wired for Junie subagents.
    // @see https://junie.jetbrains.com/docs/agent-skills.html
    return {
      relativeDirPath: JUNIE_SKILLS_DIR_PATH,
      importOnlySkillRoots: [AGENTSMD_SKILLS_DIR_PATH],
    };
  }

  getFrontmatter(): JunieSkillFrontmatter {
    const result = JunieSkillFrontmatterSchema.parse(this.requireMainFileFrontmatter());
    return result;
  }

  validate(): ValidationResult {
    return this.validateMainFileFrontmatterAndDirName(JunieSkillFrontmatterSchema);
  }

  toRulesyncSkill(): RulesyncSkill {
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
    };

    return this.toRulesyncSkillWith(rulesyncFrontmatter);
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

  protected static override readonly toolTarget = "junie";

  static async fromDir(params: ToolSkillFromDirParams): Promise<JunieSkill> {
    const loaded = await this.loadSkillDirContent({
      ...params,
      getSettablePaths: JunieSkill.getSettablePaths,
    });

    // `description` is optional upstream: "If `description` is not provided
    // in the frontmatter, Junie CLI extracts the first paragraph of the body
    // content as the description." The canonical skill frontmatter requires
    // one, so it is filled in from the body before validation rather than
    // failing a skill Junie loads fine; generation keeps emitting an explicit
    // description, as the same docs recommend. Headings are skipped, since a
    // body opening with `# Skill Name` would otherwise import the title.
    // https://junie.jetbrains.com/docs/agent-skills.html
    let frontmatter = loaded.frontmatter;
    if (isRecord(frontmatter) && frontmatter.description === undefined) {
      const derived = firstNonHeadingParagraph(loaded.body);
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

    const parsedFrontmatter = this.parseLoadedFrontmatterMatchingDirName({
      schema: JunieSkillFrontmatterSchema,
      loaded: { ...loaded, frontmatter },
    });

    return new JunieSkill({
      outputRoot: loaded.outputRoot,
      relativeDirPath: loaded.relativeDirPath,
      dirName: loaded.dirName,
      frontmatter: parsedFrontmatter,
      body: loaded.body,
      otherFiles: loaded.otherFiles,
      validate: true,
      global: loaded.global,
    });
  }

  static forDeletion(params: ToolSkillForDeletionParams): JunieSkill {
    return new JunieSkill(this.forDeletionParams(params));
  }
}
