import { join } from "node:path";
import { z } from "zod/mini";
import { RULESYNC_SKILLS_RELATIVE_DIR_PATH } from "../../constants/rulesync-paths.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { formatError } from "../../utils/error.js";
import { fileExists, getHomeDirectory, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSkill, RulesyncSkillFrontmatterInput, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

const POWER_FILE_NAME = "POWER.md";

export const KiroSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  displayName: z.optional(z.string()),
  description: z.string(),
  keywords: z.optional(z.array(z.string())),
});

export type KiroSkillFrontmatter = z.infer<typeof KiroSkillFrontmatterSchema>;

export type KiroSkillParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  frontmatter: KiroSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
  global?: boolean;
};

/**
 * Skill generator for Kiro IDE (Powers)
 *
 * Generates power directories for Kiro IDE's powers system.
 * Powers are global-only and installed to ~/.kiro/powers/installed/{power-name}/
 * Only POWER.md, mcp.json, and steering/*.md files are allowed.
 */
export class KiroSkill extends ToolSkill {
  constructor({
    baseDir = process.cwd(),
    relativeDirPath = join(".kiro", "powers", "installed"),
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
    global = false,
  }: KiroSkillParams) {
    // Filter otherFiles to only allow mcp.json and steering/*.md
    const allowedOtherFiles = otherFiles.filter((file) => {
      const filePath = file.relativeFilePathToDirPath;
      return (
        filePath === "mcp.json" || (filePath.startsWith("steering/") && filePath.endsWith(".md"))
      );
    });

    super({
      baseDir,
      relativeDirPath,
      dirName,
      mainFile: {
        name: POWER_FILE_NAME,
        body,
        frontmatter: { ...frontmatter },
      },
      otherFiles: allowedOtherFiles,
      global,
    });

    if (validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolSkillSettablePaths {
    // Kiro powers are global-only, installed to ~/.kiro/powers/installed/
    if (global) {
      return {
        relativeDirPath: join(".kiro", "powers", "installed"),
      };
    }
    // Project scope not supported, but return a path for compatibility
    return {
      relativeDirPath: join(".kiro", "powers", "installed"),
    };
  }

  getFrontmatter(): KiroSkillFrontmatter {
    if (!this.mainFile?.frontmatter) {
      throw new Error("Frontmatter is not defined");
    }
    return KiroSkillFrontmatterSchema.parse(this.mainFile.frontmatter);
  }

  getBody(): string {
    return this.mainFile?.body ?? "";
  }

  validate(): ValidationResult {
    if (this.mainFile === undefined) {
      return {
        success: false,
        error: new Error(`${this.getDirPath()}: ${POWER_FILE_NAME} file does not exist`),
      };
    }
    const result = KiroSkillFrontmatterSchema.safeParse(this.mainFile.frontmatter);
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
    const rulesyncFrontmatter: RulesyncSkillFrontmatterInput = {
      name: frontmatter.name,
      description: frontmatter.description,
      targets: ["*"],
      kiro: {
        ...(frontmatter.displayName && { displayName: frontmatter.displayName }),
        ...(frontmatter.keywords && { keywords: frontmatter.keywords }),
      },
    };

    // Remove empty kiro object
    if (Object.keys(rulesyncFrontmatter.kiro ?? {}).length === 0) {
      delete rulesyncFrontmatter.kiro;
    }

    // For import, always output to process.cwd() regardless of global mode
    return new RulesyncSkill({
      baseDir: process.cwd(),
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
    rulesyncSkill,
    validate = true,
    global = false,
  }: ToolSkillFromRulesyncSkillParams): KiroSkill {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();
    const kiroFields = rulesyncFrontmatter.kiro;

    const kiroFrontmatter: KiroSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
      ...(kiroFields?.displayName ? { displayName: kiroFields.displayName } : {}),
      ...(kiroFields?.keywords ? { keywords: kiroFields.keywords } : {}),
    };

    const settablePaths = KiroSkill.getSettablePaths({ global });

    // Kiro powers are global-only, so use home directory as baseDir
    const baseDir = global ? getHomeDirectory() : rulesyncSkill.getBaseDir();

    return new KiroSkill({
      baseDir,
      relativeDirPath: settablePaths.relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: kiroFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
      global,
    });
  }

  static isTargetedByRulesyncSkill(rulesyncSkill: RulesyncSkill): boolean {
    const targets = rulesyncSkill.getFrontmatter().targets;
    return targets.includes("*") || targets.includes("kiro");
  }

  static async fromDir(params: ToolSkillFromDirParams): Promise<KiroSkill> {
    const { baseDir = process.cwd(), relativeDirPath, dirName, global = false } = params;
    const settablePaths = KiroSkill.getSettablePaths({ global });
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = join(baseDir, actualRelativeDirPath, dirName);
    const powerFilePath = join(skillDirPath, POWER_FILE_NAME);

    if (!(await fileExists(powerFilePath))) {
      throw new Error(`${POWER_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(powerFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent);

    const result = KiroSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(
        `Invalid frontmatter in ${join(skillDirPath, POWER_FILE_NAME)}: ${formatError(result.error)}`,
      );
    }

    const otherFiles = await this.collectOtherFiles(
      baseDir,
      actualRelativeDirPath,
      dirName,
      POWER_FILE_NAME,
    );

    return new KiroSkill({
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

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
  }: ToolSkillForDeletionParams): KiroSkill {
    return new KiroSkill({
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
      global,
    });
  }
}
