import { basename, join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../types/ai-file.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { formatError } from "../utils/error.js";
import {
  directoryExists,
  fileExists,
  getHomeDirectory,
  listDirectoryFiles,
  readFileContent,
} from "../utils/file.js";
import { parseFrontmatter } from "../utils/frontmatter.js";
import { logger } from "../utils/logger.js";

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
    // Validate frontmatter before calling super to avoid validation order issues
    if (rest.validate !== false) {
      const result = RulesyncSkillFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(rest.relativeDirPath, rest.relativeFilePath)}: ${formatError(result.error)}`,
        );
      }
    }

    super({
      ...rest,
    });

    this.frontmatter = frontmatter;
    this.body = body;
    this.otherSkillFiles = otherSkillFiles;
  }

  static getSettablePaths(global: boolean = false): RulesyncSkillSettablePaths {
    if (global) {
      const homeDir = getHomeDirectory();
      return {
        relativeDirPath: join(homeDir, ".rulesync", "skills"),
      };
    }
    return {
      relativeDirPath: join(".rulesync", "skills"),
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
  private static async collectSkillFiles(
    skillDir: string,
    basePath: string = "",
  ): Promise<SkillFile[]> {
    const files: SkillFile[] = [];

    try {
      const entries = await listDirectoryFiles(skillDir);

      for (const entry of entries) {
        const fullPath = join(skillDir, entry);
        const relativePath = basePath ? join(basePath, entry) : entry;

        // Skip SKILL.md
        if (entry === "SKILL.md") {
          continue;
        }

        const isDir = await directoryExists(fullPath);

        if (isDir) {
          // Recursively collect files from subdirectories
          const subFiles = await this.collectSkillFiles(fullPath, relativePath);
          files.push(...subFiles);
        } else {
          // For files, read content and store relative path info
          const fileContent = await readFileContent(fullPath);
          const dirPath = basePath || ".";

          files.push({
            relativeDirPath: dirPath,
            relativeFilePath: entry,
            fileContent,
            children: [],
          });
        }
      }
    } catch (error) {
      // If directory doesn't exist or can't be read, log the error and return empty array
      logger.error(`Failed to collect skill files from ${skillDir}: ${formatError(error)}`);
      return [];
    }

    return files;
  }

  static async fromFile({
    relativeFilePath,
    skillName,
    global = false,
  }: RulesyncSkillFromFileParams): Promise<RulesyncSkill> {
    const baseDir = global ? getHomeDirectory() : ".";
    const settablePaths = this.getSettablePaths(global);
    // For global mode, settablePaths already includes homeDir, so we don't need to join with baseDir
    const skillDir = global
      ? join(settablePaths.relativeDirPath, skillName)
      : join(baseDir, settablePaths.relativeDirPath, skillName);
    const skillFilePath = join(skillDir, "SKILL.md");

    // Check if SKILL.md exists
    if (!(await fileExists(skillFilePath))) {
      throw new Error(`SKILL.md not found in ${skillDir}`);
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
      baseDir,
      relativeDirPath: join(settablePaths.relativeDirPath, skillName),
      relativeFilePath: filename,
      frontmatter: result.data,
      body: content.trim(),
      fileContent,
      otherSkillFiles,
      global,
    });
  }
}
