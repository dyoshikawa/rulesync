import { basename, dirname, join, relative, sep } from "node:path";
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
import { fileExists, findFilesByGlobs, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { logger } from "../../utils/logger.js";

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
  relativeDirPath: string;
  relativeFilePath: string;
  fileContent: string;
  children: SkillFile[];
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

export class RulesyncSkill extends RulesyncFile {
  private readonly frontmatter: RulesyncSkillFrontmatter;
  private readonly body: string;
  private readonly otherSkillFiles: SkillFile[];

  constructor({ frontmatter, body, otherSkillFiles, ...rest }: RulesyncSkillParams) {
    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.otherSkillFiles = otherSkillFiles;

    if (rest.validate) {
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
  private static async collectSkillFiles(skillDir: string): Promise<SkillFile[]> {
    try {
      // Find all files in the skill directory (recursively) except SKILL.md
      const glob = join(skillDir, "**", "*");
      const allPaths = await findFilesByGlobs(glob);

      // Filter to only regular files and exclude SKILL.md
      const skillFiles = allPaths.filter((path) => {
        const fileName = basename(path);
        return fileName !== SKILL_FILE_NAME;
      });

      // Convert paths to SkillFile objects
      const files: SkillFile[] = [];
      for (const filePath of skillFiles) {
        const fileContent = await readFileContent(filePath);
        // Calculate relative directory path from skill directory (Windows-compatible)
        const relativePath = relative(skillDir, filePath);
        const relativeDir = relativePath.includes(sep) ? dirname(relativePath) : ".";

        files.push({
          relativeDirPath: relativeDir,
          relativeFilePath: basename(filePath),
          fileContent,
          children: [],
        });
      }

      return files;
    } catch (error) {
      // If directory doesn't exist or can't be read, log the error and return empty array
      logger.error(`Failed to collect skill files from ${skillDir}: ${formatError(error)}`);
      return [];
    }
  }

  static async fromFile({
    baseDir,
    relativeFilePath,
    skillName,
  }: RulesyncSkillFromFileParams & { skillName: string }): Promise<RulesyncSkill> {
    const settablePaths = this.getSettablePaths();
    const skillDir = join(baseDir || process.cwd(), settablePaths.relativeDirPath, skillName);
    const skillFilePath = join(skillDir, SKILL_FILE_NAME);

    // Check if SKILL.md exists
    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDir}`);
    }

    // Read and parse SKILL.md
    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    // Validate frontmatter using SkillFrontmatterSchema
    const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }

    // Collect all skill files except SKILL.md
    const otherSkillFiles = await this.collectSkillFiles(skillDir);

    const filename = basename(relativeFilePath);

    return new RulesyncSkill({
      baseDir: baseDir || process.cwd(),
      relativeDirPath: join(settablePaths.relativeDirPath, skillName),
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      otherSkillFiles,
    });
  }
}
