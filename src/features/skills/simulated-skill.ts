import { join } from "node:path";

import { z } from "zod/mini";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { ValidationResult } from "../../types/ai-dir.js";
import { ToolTarget } from "../../types/tool-targets.js";
import { formatError } from "../../utils/error.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSkill, SkillFile } from "./rulesync-skill.js";
import {
  ToolSkill,
  ToolSkillForDeletionParams,
  ToolSkillFromDirParams,
  ToolSkillFromRulesyncSkillParams,
  ToolSkillSettablePaths,
} from "./tool-skill.js";

export const SimulatedSkillFrontmatterSchema = z.looseObject({
  name: z.string(),
  description: z.string(),
});

export type SimulatedSkillFrontmatter = z.infer<typeof SimulatedSkillFrontmatterSchema>;

export type SimulatedSkillParams = {
  baseDir?: string;
  relativeDirPath: string;
  dirName: string;
  frontmatter: SimulatedSkillFrontmatter;
  body: string;
  otherFiles?: SkillFile[];
  validate?: boolean;
};

/**
 * Abstract base class for simulated skill formats.
 *
 * Simulated skills are used for tools that don't have native skill support
 * (e.g., Copilot, Cursor, CodexCLI). They provide a simplified skill format
 * with minimal frontmatter (name and description only).
 *
 * Unlike native skills, simulated skills:
 * - Cannot be converted back to RulesyncSkill (one-way conversion)
 * - Have minimal frontmatter (no tool-specific options like allowed-tools)
 */
export abstract class SimulatedSkill extends ToolSkill {
  private readonly frontmatter: SimulatedSkillFrontmatter;
  private readonly body: string;

  constructor({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    frontmatter,
    body,
    otherFiles = [],
    validate = true,
  }: SimulatedSkillParams) {
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
      global: false, // Simulated skills are project mode only
    });

    if (validate) {
      const result = SimulatedSkillFrontmatterSchema.safeParse(frontmatter);
      if (!result.success) {
        throw new Error(
          `Invalid frontmatter in ${join(relativeDirPath, dirName)}: ${formatError(result.error)}`,
        );
      }
    }

    this.frontmatter = frontmatter;
    this.body = body;
  }

  getBody(): string {
    return this.body;
  }

  getFrontmatter(): SimulatedSkillFrontmatter {
    return this.frontmatter;
  }

  toRulesyncSkill(): RulesyncSkill {
    throw new Error("Not implemented because it is a SIMULATED skill.");
  }

  validate(): ValidationResult {
    if (!this.frontmatter) {
      return { success: true, error: null };
    }

    const result = SimulatedSkillFrontmatterSchema.safeParse(this.frontmatter);
    if (result.success) {
      return { success: true, error: null };
    } else {
      return {
        success: false,
        error: new Error(
          `Invalid frontmatter in ${this.getDirPath()}: ${formatError(result.error)}`,
        ),
      };
    }
  }

  protected static fromRulesyncSkillDefault({
    rulesyncSkill,
    validate = true,
  }: ToolSkillFromRulesyncSkillParams): SimulatedSkillParams {
    const rulesyncFrontmatter = rulesyncSkill.getFrontmatter();

    // Simulated skills use minimal frontmatter
    const simulatedFrontmatter: SimulatedSkillFrontmatter = {
      name: rulesyncFrontmatter.name,
      description: rulesyncFrontmatter.description,
    };

    return {
      baseDir: rulesyncSkill.getBaseDir(),
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      dirName: rulesyncSkill.getDirName(),
      frontmatter: simulatedFrontmatter,
      body: rulesyncSkill.getBody(),
      otherFiles: rulesyncSkill.getOtherFiles(),
      validate,
    };
  }

  protected static async fromDirDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
  }: ToolSkillFromDirParams): Promise<SimulatedSkillParams> {
    const settablePaths = this.getSettablePaths();
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = join(baseDir, actualRelativeDirPath, dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, skillFilePath);

    const result = SimulatedSkillFrontmatterSchema.safeParse(frontmatter);
    if (!result.success) {
      throw new Error(`Invalid frontmatter in ${skillFilePath}: ${formatError(result.error)}`);
    }

    const otherFiles = await this.collectOtherFiles(
      baseDir,
      actualRelativeDirPath,
      dirName,
      SKILL_FILE_NAME,
    );

    return {
      baseDir,
      relativeDirPath: actualRelativeDirPath,
      dirName,
      frontmatter: result.data,
      body: content.trim(),
      otherFiles,
      validate: true,
    };
  }

  /**
   * Create minimal params for deletion purposes.
   * This method does not read or parse directory content, making it safe to use
   * even when skill files have old/incompatible formats.
   */
  protected static forDeletionDefault({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
  }: ToolSkillForDeletionParams): SimulatedSkillParams {
    return {
      baseDir,
      relativeDirPath,
      dirName,
      frontmatter: { name: "", description: "" },
      body: "",
      otherFiles: [],
      validate: false,
    };
  }

  /**
   * Check if a RulesyncSkill should be converted to this simulated skill type.
   * Uses the targets field in the RulesyncSkill frontmatter to determine targeting.
   */
  protected static isTargetedByRulesyncSkillDefault({
    rulesyncSkill,
    toolTarget,
  }: {
    rulesyncSkill: RulesyncSkill;
    toolTarget: ToolTarget;
  }): boolean {
    const frontmatter = rulesyncSkill.getFrontmatter();
    const targets = frontmatter.targets;

    // If targets includes "*", it targets all tools
    if (targets.includes("*")) {
      return true;
    }

    // Check if the specific tool is in the targets array
    return targets.includes(toolTarget);
  }

  /**
   * Get the settable paths for this tool's skill directories.
   * Must be implemented by concrete subclasses.
   */
  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }
}
