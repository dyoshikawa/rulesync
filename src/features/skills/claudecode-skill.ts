import { basename, join, relative } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { fileExists, findFilesByGlobs, readFileBuffer, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSkill, RulesyncSkillFrontmatter, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const ClaudecodeSkillFrontmatterSchema = z.object({
  name: z.string(),
  description: z.string(),
  "allowed-tools": z.optional(z.array(z.string())),
});

export type ClaudecodeSkillFrontmatter = z.infer<typeof ClaudecodeSkillFrontmatterSchema>;

export type ClaudecodeSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: ClaudecodeSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Represents a Claude Code skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 * Extends ToolSkill to inherit directory management and security features from AiDir.
 */
export class ClaudecodeSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".claude", "skills"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: ClaudecodeSkillParams) {
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

  static getSettablePaths(_options: { global?: boolean } = {}): ToolSkillSettablePaths {
    return {
      relativeDirPath: join(".claude", "skills"),
    };
  }

  getFrontmatter(): ClaudecodeSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    const result = ClaudecodeSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
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
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const frontmatter = this.getFrontmatter();
    const rulesyncFrontmatter: RulesyncSkillFrontmatter = {
      name: frontmatter.name,
      description: frontmatter.description,
      ...(frontmatter["allowed-tools"] && {
        claudecode: {
          "allowed-tools": frontmatter["allowed-tools"],
        },
      }),
    };

    return new RulesyncSkill({
      baseDir: this.baseDir,
      relativeDirPath: this.relativeDirPath,
      dirName: this.getDirName(),
      frontmatter: rulesyncFrontmatter,
      body: this.getBody(),
      otherFiles: this.getOtherFiles(),
      validate: true,
      global: this.global,
    });
  }

  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): ClaudecodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      "allowed-tools": rulesyncFrontmatter.claudecode?.["allowed-tools"],
    };

    const settablePaths = ClaudecodeSkill.getSettablePaths({ global });

    return new ClaudecodeSkill({
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(_rulesyncSkill: RulesyncSkill): boolean {
    // Skills don't have targets field like commands/subagents do
    // All skills are available to Claude Code
    return true;
  }

  /**
   * Recursively collects all skill files from a directory, excluding SKILL.md
   */
  protected static async collectOtherFiles(
    baseDir: string,
    relativeDirPath: string,
    dirName: string,
  ): Promise<SkillFile[]> {
    const skillDirPath = join(baseDir, relativeDirPath, dirName);
    const glob = join(skillDirPath, "**", "*");
    const filePaths = await findFilesByGlobs(glob, { fileOnly: true });
    const filePathsWithoutSkillMd = filePaths.filter(
      (filePath) => basename(filePath) !== SKILL_FILE_NAME,
    );
    const files: SkillFile[] = await Promise.all(
      filePathsWithoutSkillMd.map(async (filePath) => {
        const fileBuffer = await readFileBuffer(filePath);
        return {
          relativeFilePathToDirPath: relative(skillDirPath, filePath),
          fileBuffer,
        };
      }),
    );
    return files;
  }

  static async fromDir({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillFromDirParams): Promise<ClaudecodeSkill> {
    const settablePaths = this.getSettablePaths({ global });
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = join(baseDir, actualRelativeDirPath, dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = ClaudecodeSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }

    const otherFiles = await this.collectOtherFiles(baseDir, actualRelativeDirPath, dirName);

    return new ClaudecodeSkill({
      baseDir,
      relativeDirPath: actualRelativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
      global,
    });
  }
}
