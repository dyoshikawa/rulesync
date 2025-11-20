import { basename, join, relative } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { fileExists, findFilesByGlobs, readFileBuffer, readFileContent } from "../../utils/file.js";
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

export type SkillFile = {
  /**
   * Relative to .rulesync/skills/{skillDirName}
   *
   * @example "scripts/search.ts"
   */
  relativeFilePathToSkillDirPath: string;
  fileBuffer: Buffer;
};

export type RulesyncSkillParams = {
  skillDirName: string;
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherSkillFiles: SkillFile[];
  validate?: boolean;
};

export type RulesyncSkillSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSkillFromFileParams = {
  skillDirName: string;
};

/**
 * This is a dir, not a file, so not extending RulesyncFile.
 */
export class RulesyncSkill {
  private readonly skillDirName: string;
  private readonly frontmatter: RulesyncSkillFrontmatter;
  private readonly body: string;
  private readonly otherSkillFiles: SkillFile[];

  constructor({
    skillDirName,
    frontmatter,
    body,
    otherSkillFiles,
    validate = true,
  }: RulesyncSkillParams) {
    this.frontmatter = frontmatter;
    this.body = body;
    this.otherSkillFiles = otherSkillFiles;
    this.skillDirName = skillDirName;

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncSkillSettablePaths {
    return {
      relativeDirPath: RULESYNC_SKILLS_RELATIVE_DIR_PATH,
    };
  }

  getFrontmatter(): RulesyncSkillFrontmatter {
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  getOtherSkillFiles(): SkillFile[] {
    return this.otherSkillFiles;
  }

  getSkillDirName(): string {
    return this.skillDirName;
  }

  validate(): ValidationResult {
    const result = RulesyncSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(process.cwd(), RulesyncSkill.getSettablePaths().relativeDirPath, this.skillDirName)}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  /**
   * Recursively collects all skill files from a directory, excluding SKILL.md
   */
  private static async collectOtherSkillFiles(skillDirName: string): Promise<SkillFile[]> {
    const skillDirPath = join(
      process.cwd(),
      RulesyncSkill.getSettablePaths().relativeDirPath,
      skillDirName,
    );
    const glob = join(skillDirPath, "**", "*");
    const filePaths = await findFilesByGlobs(glob, { fileOnly: true });
    const filePathsWithoutSkillMd = filePaths.filter(
      (filePath) => basename(filePath) !== SKILL_FILE_NAME,
    );
    const files: SkillFile[] = await Promise.all(
      filePathsWithoutSkillMd.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeFilePathToSkillDirPath: relative(skillDirPath, filePath),
          fileBuffer,
        };
      }),
    );
    return files;
  }

  static async fromDir({ skillDirName }: RulesyncSkillFromFileParams): Promise<RulesyncSkill> {
    const settablePaths = this.getSettablePaths();
    const skillDirPath = join(process.cwd(), settablePaths.relativeDirPath, skillDirName);
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
    const otherSkillFiles = await this.collectOtherSkillFiles(skillDirName);

    return new RulesyncSkill({
      skillDirName: skillDirName,
      frontmatter: result.data,
      body: content.trim(),
      otherSkillFiles,
      validate: true,
    });
  }
}
