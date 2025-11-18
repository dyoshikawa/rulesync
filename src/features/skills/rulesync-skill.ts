import { basename, join, relative } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../../types/rulesync-file.js";
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
   * Relative to .rulesync/skills
   *
   * @example "my-skill"
   */
  relativeDirPath: string;
  /**
   * Relative to .rulesync/skills/<skill-name>
   *
   * @example "scripts/search.ts"
   */
  relativeFilePath: string;
  fileBuffer: Buffer;
};

export type RulesyncSkillParams = {
  frontmatter: RulesyncSkillFrontmatter;
  body: string;
  otherSkillFiles: SkillFile[];
} & RulesyncFileParams;

export type RulesyncSkillSettablePaths = {
  relativeDirPath: string;
};

export type RulesyncSkillFromFileParams = RulesyncFileFromFileParams & {
  skillName: string;
};

/**
 * This is a dir, not a file, so not extending RulesyncFile.
 */
export class RulesyncSkill {
  private readonly frontmatter: RulesyncSkillFrontmatter;
  private readonly body: string;
  private readonly otherSkillFiles: SkillFile[];

  constructor({
    frontmatter,
    body,
    otherSkillFiles,
    validate = true,
    ...rest
  }: RulesyncSkillParams) {
    this.frontmatter = frontmatter;
    this.body = body;
    this.otherSkillFiles = otherSkillFiles;

    if (validate) {
      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
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

  validate(): ValidationResult {
    // Check if frontmatter is set (may be undefined during construction)
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = RulesyncSkillFrontmatterSchema.safeParse(this.frontmatter);

    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  /**
   * Recursively collects all skill files from a directory, excluding SKILL.md
   */
  private static async collectOtherSkillFiles(skillDirPath: string): Promise<SkillFile[]> {
    const glob = join(skillDirPath, "**", "*");
    const filePaths = await findFilesByGlobs(glob, { fileOnly: true });
    const filePathsWithoutSkillMd = filePaths.filter(
      (filePath) => basename(filePath) !== SKILL_FILE_NAME,
    );
    const files: SkillFile[] = await Promise.all(
      filePathsWithoutSkillMd.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeDirPath: skillDirPath,
          relativeFilePath: relative(skillDirPath, filePath),
          fileBuffer,
        };
      }),
    );
    return files;
  }

  static async fromDir({
    skillName,
  }: RulesyncSkillFromFileParams & { skillName: string }): Promise<RulesyncSkill> {
    const settablePaths = this.getSettablePaths();
    const skillDirPath = join(process.cwd(), settablePaths.relativeDirPath, skillName);
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
    const otherSkillFiles = await this.collectOtherSkillFiles(skillDirPath);

    return new RulesyncSkill({
      baseDir: process.cwd(),
      relativeDirPath: join(settablePaths.relativeDirPath, skillName),
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      otherSkillFiles,
    });
  }
}
