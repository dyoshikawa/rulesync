import { basename, join, relative } from "node:path";
import { z } from "zod/mini";
import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import {
  fileExists,
  findFilesByGlobs,
  readFileBuffer,
  readFileContent,
  writeFileBuffer,
  writeFileContent,
} from "../../utils/file.js";
import { parseFrontmatter, stringifyFrontmatter } from "../../utils/frontmatter.js";
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
  dirName: string;
  frontmatter: ClaudecodeSkillFrontmatter;
  body: string;
  otherFiles: SkillFile[];
  validate?: boolean;
};

/**
 * Represents a Claude Code skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 */
export class ClaudecodeSkill extends ToolSkill {
  private readonly dirName: string;
  private readonly frontmatter: ClaudecodeSkillFrontmatter;
  private readonly body: string;
  private readonly otherFiles: SkillFile[];

  constructor({ dirName, frontmatter, body, otherFiles, validate = true }: ClaudecodeSkillParams) {
    super();
    this.dirName = dirName;
    this.frontmatter = frontmatter;
    this.body = body;
    this.otherFiles = otherFiles;

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
    return this.frontmatter;
  }

  getBody(): string {
    return this.body;
  }

  getOtherFiles(): SkillFile[] {
    return this.otherFiles;
  }

  getDirName(): string {
    return this.dirName;
  }

  validate(): ValidationResult {
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(ClaudecodeSkill.getSettablePaths().relativeDirPath, this.dirName)}: ${formatError(result.error)}`,
        ),
      };
    }

    return { success: true, error: null };
  }

  toRulesyncSkill(): RulesyncSkill {
    const rulesyncFrontmatter: RulesyncSkillFrontmatter = {
      name: this.frontmatter.name,
      description: this.frontmatter.description,
      ...(this.frontmatter["allowed-tools"] && {
        claudecode: {
          "allowed-tools": this.frontmatter["allowed-tools"],
        },
      }),
    };

    return new RulesyncSkill({
      dirName: this.dirName,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      otherFiles: this.otherFiles,
      validate: true,
    });
  }

  static fromRulesyncSkill({
    rulesyncSkill,
    validate = true,
  }: ToolSkillFromRulesyncSkillParams): ClaudecodeSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    const claudecodeFrontmatter: ClaudecodeSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      "allowed-tools": rulesyncFrontmatter.claudecode?.["allowed-tools"],
    };

    return new ClaudecodeSkill({
      dirName: rulesyncSkill.getDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
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
  private static async collectOtherSkillFiles(dirName: string): Promise<SkillFile[]> {
    const skillDirPath = join(
      process.cwd(),
      ClaudecodeSkill.getSettablePaths().relativeDirPath,
      dirName,
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
          relativeFilePathToDirPath: relative(skillDirPath, filePath),
          fileBuffer,
        };
      }),
    );
    return files;
  }

  static async fromDir({ dirName }: ToolSkillFromDirParams): Promise<ClaudecodeSkill> {
    const settablePaths = this.getSettablePaths();
    const skillDirPath = join(process.cwd(), settablePaths.relativeDirPath, dirName);
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

    const otherFiles = await this.collectOtherSkillFiles(dirName);

    return new ClaudecodeSkill({
      dirName: dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
    });
  }

  /**
   * Write the skill to the file system
   */
  async write(baseDir: string = process.cwd()): Promise<void> {
    const settablePaths = ClaudecodeSkill.getSettablePaths();
    const skillDirPath = join(baseDir, settablePaths.relativeDirPath, this.dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    // Write SKILL.md
    const fileContent = stringifyFrontmatter(this.body, this.frontmatter);
    await writeFileContent(skillFilePath, fileContent);

    // Write other skill files
    for (const skillFile of this.otherFiles) {
      const filePath = join(skillDirPath, skillFile.relativeFilePathToDirPath);
      await writeFileBuffer(filePath, skillFile.fileBuffer);
    }
  }
}
