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
  skillDirName: string;
  frontmatter: ClaudecodeSkillFrontmatter;
  body: string;
  otherSkillFiles: SkillFile[];
  validate?: boolean;
};

/**
 * Represents a Claude Code skill directory.
 * Unlike subagents and commands, skills are directories containing SKILL.md and other files.
 */
export class ClaudecodeSkill extends ToolSkill {
  private readonly skillDirName: string;
  private readonly frontmatter: ClaudecodeSkillFrontmatter;
  private readonly body: string;
  private readonly otherSkillFiles: SkillFile[];

  constructor({
    skillDirName,
    frontmatter,
    body,
    otherSkillFiles,
    validate = true,
  }: ClaudecodeSkillParams) {
    super();
    this.skillDirName = skillDirName;
    this.frontmatter = frontmatter;
    this.body = body;
    this.otherSkillFiles = otherSkillFiles;

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

  getOtherSkillFiles(): SkillFile[] {
    return this.otherSkillFiles;
  }

  getSkillDirName(): string {
    return this.skillDirName;
  }

  validate(): ValidationResult {
    const result = ClaudecodeSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (!result.success) {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${join(ClaudecodeSkill.getSettablePaths().relativeDirPath, this.skillDirName)}: ${formatError(result.error)}`,
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
      skillDirName: this.skillDirName,
      frontmatter: rulesyncFrontmatter,
      body: this.body,
      otherSkillFiles: this.otherSkillFiles,
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
      skillDirName: rulesyncSkill.getSkillDirName(),
      frontmatter: claudecodeFrontmatter,
      body: rulesyncSkill.getBody(),
      otherSkillFiles: rulesyncSkill.getOtherSkillFiles(),
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
  private static async collectOtherSkillFiles(skillDirName: string): Promise<SkillFile[]> {
    const skillDirPath = join(
      process.cwd(),
      ClaudecodeSkill.getSettablePaths().relativeDirPath,
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

  static async fromDir({ skillDirName }: ToolSkillFromDirParams): Promise<ClaudecodeSkill> {
    const settablePaths = this.getSettablePaths();
    const skillDirPath = join(process.cwd(), settablePaths.relativeDirPath, skillDirName);
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

    const otherSkillFiles = await this.collectOtherSkillFiles(skillDirName);

    return new ClaudecodeSkill({
      skillDirName: skillDirName,
      frontmatter: result.data,
      body: content.trim(),
      otherSkillFiles,
      validate: true,
    });
  }

  /**
   * Write the skill to the file system
   */
  async write(baseDir: string = process.cwd()): Promise<void> {
    const settablePaths = ClaudecodeSkill.getSettablePaths();
    const skillDirPath = join(baseDir, settablePaths.relativeDirPath, this.skillDirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    // Write SKILL.md
    const fileContent = stringifyFrontmatter(this.body, this.frontmatter);
    await writeFileContent(skillFilePath, fileContent);

    // Write other skill files
    for (const skillFile of this.otherSkillFiles) {
      const filePath = join(skillDirPath, skillFile.relativeFilePathToSkillDirPath);
      await writeFileBuffer(filePath, skillFile.fileBuffer);
    }
  }
}
