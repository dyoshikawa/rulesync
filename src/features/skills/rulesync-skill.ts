import { join } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { AiDir, AiDirFile, ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";

export const RulesyncSkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  claudecode: z.optional(
    z.object({
      "allowed-tools": z.optional(z.array(z.string())),
    }),
  ),
});

export type RulesyncSkillFrontmatter = z.infer<typeof RulesyncSkillFrontmatterSchema>;

/**
 * Type alias for AiDirFile, specific to skill files
 */
export type SkillFile = AiDirFile;

export type RulesyncSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherFiles?: AiDirFile[];
  validate?: boolean;
  global?: boolean;
};

export type RulesyncSkillSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSkillFromDirParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  global?: boolean;
};

/**
 * Represents a Rulesync skill directory with SKILL.md and optional additional files.
 * Extends AiDir to inherit directory management and security features.
 */
export class RulesyncSkill extends AiDir {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: RulesyncSkillParams) {
    super({
      baseDir,
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

  static getSettablePaths(): RulesyncSkillSettablePaths {
    // Rulesync skills use the same relative path for both project and global modes
    // The actual location differs based on baseDir:
    // - Project mode: {process.cwd()}/.rulesync/skills/
    // - Global mode: {getHomeDirectory()}/.rulesync/skills/
    return {
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = RulesyncSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
    return result;
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    const result = RulesyncSkillFrontmatterSchema.safeParse(this.mainFile?.frontmatter);
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

  static async fromDir({
    baseDir = process.cwd(),
    relativeDirPath = RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    dirName,
    global = false,
  }: RulesyncSkillFromDirParams): Promise<RulesyncSkill> {
    const skillDirPath = join(baseDir, relativeDirPath, dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }
    const otherFiles = await this.collectOtherFiles(
      baseDir,
      relativeDirPath,
      dirName,
      SKILL_FILE_NAME,
    );

    return new RulesyncSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
      global,
    });
  }
}
