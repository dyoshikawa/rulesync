import { join } from "node:path";

import { SKILL_FILE_NAME } from "../../constants/general.js";
import { AiDir } from "../../types/ai-dir.js";
import { fileExists, readFileContent } from "../../utils/file.js";
import { parseFrontmatter } from "../../utils/frontmatter.js";
import { RulesyncSkill, SkillFile } from "./rulesync-skill.js";

export type ToolSkillFromRulesyncSkillParams = {
  rulesyncSkill: RulesyncSkill;
  validate?: boolean;
  global?: boolean;
};

export type ToolSkillSettablePaths = {
  relativeDirPath: string;
};

export type ToolSkillFromDirParams = {
  baseDir?: string;
  relativeDirPath?: string;
  dirName: string;
  global?: boolean;
};

export type ToolSkillForDeletionParams = {
  baseDir?: string;
  relativeDirPath: string;
  dirName: string;
  global?: boolean;
};

/**
 * Common data loaded from a skill directory.
 * Used by loadSkillDirContent to return parsed file data.
 */
export type LoadedSkillDirContent = {
  baseDir: string;
  relativeDirPath: string;
  dirName: string;
  frontmatter: Record<string, unknown>;
  body: string;
  otherFiles: SkillFile[];
  global: boolean;
};

/**
 * Abstract base class for AI development tool-specific skill formats.
 *
 * ToolSkill extends AiDir to inherit directory management and security features.
 * It serves as an intermediary between RulesyncSkill (internal format)
 * and specific tool skill formats (e.g., Claude Code).
 *
 * Unlike ToolCommand and ToolSubagent which are file-based, ToolSkill represents
 * a directory structure containing SKILL.md and other skill files.
 *
 * It provides a consistent interface for:
 * - Converting from RulesyncSkill to tool-specific format
 * - Converting from tool-specific format back to RulesyncSkill
 * - Loading skills directly from tool-specific directories
 *
 * Concrete implementations should handle:
 * - Tool-specific frontmatter structure and validation
 * - Tool-specific directory naming conventions
 * - Tool-specific skill file formats
 */
export abstract class ToolSkill extends AiDir {
  /**
   * Get the settable paths for this tool's skill directories.
   *
   * @param options - Optional configuration including global mode
   * @returns Object containing the relative directory path
   */
  static getSettablePaths(_options?: { global?: boolean }): ToolSkillSettablePaths {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Load a skill from a tool-specific directory.
   *
   * This method should:
   * 1. Read the SKILL.md file content
   * 2. Parse tool-specific frontmatter format
   * 3. Validate the parsed data
   * 4. Collect other skill files in the directory
   * 5. Return a concrete ToolSkill instance
   *
   * @param params - Parameters including the skill directory name
   * @returns Promise resolving to a concrete ToolSkill instance
   */
  static async fromDir(_params: ToolSkillFromDirParams): Promise<ToolSkill> {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Create a minimal instance for deletion purposes.
   * This method does not read or parse directory content, making it safe to use
   * even when skill files have old/incompatible formats.
   */
  static forDeletion(_params: ToolSkillForDeletionParams): ToolSkill {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Convert a RulesyncSkill to the tool-specific skill format.
   *
   * This method should:
   * 1. Extract relevant data from the RulesyncSkill
   * 2. Transform frontmatter to tool-specific format
   * 3. Transform body content if needed
   * 4. Preserve other skill files
   * 5. Return a concrete ToolSkill instance
   *
   * @param params - Parameters including the RulesyncSkill to convert
   * @returns A concrete ToolSkill instance
   */
  static fromRulesyncSkill(_params: ToolSkillFromRulesyncSkillParams): ToolSkill {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Convert this tool-specific skill back to a RulesyncSkill.
   *
   * This method should:
   * 1. Transform tool-specific frontmatter to RulesyncSkill format
   * 2. Transform body content if needed
   * 3. Preserve other skill files
   * 4. Return a RulesyncSkill instance
   *
   * @returns A RulesyncSkill instance
   */
  abstract toRulesyncSkill(): RulesyncSkill;

  /**
   * Check if this tool is targeted by a RulesyncSkill.
   * Since skills don't have targets field like commands/subagents,
   * the default behavior may vary by tool.
   *
   * @param rulesyncSkill - The RulesyncSkill to check
   * @returns True if this tool should use the skill
   */
  static isTargetedByRulesyncSkill(_rulesyncSkill: RulesyncSkill): boolean {
    throw new Error("Please implement this method in the subclass.");
  }

  /**
   * Load and parse skill directory content.
   * This is a helper method that handles the common logic of reading SKILL.md,
   * parsing frontmatter, and collecting other files.
   *
   * Subclasses should call this method and then validate the frontmatter
   * against their specific schema.
   *
   * @param params - Parameters including settablePaths callback to get tool-specific paths
   * @returns Parsed skill directory content
   */
  protected static async loadSkillDirContent({
    baseDir = process.cwd(),
    relativeDirPath,
    dirName,
    global = false,
    getSettablePaths,
  }: ToolSkillFromDirParams & {
    getSettablePaths: (options: { global: boolean }) => ToolSkillSettablePaths;
  }): Promise<LoadedSkillDirContent> {
    const settablePaths = getSettablePaths({ global });
    const actualRelativeDirPath = relativeDirPath ?? settablePaths.relativeDirPath;
    const skillDirPath = join(baseDir, actualRelativeDirPath, dirName);
    const skillFilePath = join(skillDirPath, SKILL_FILE_NAME);

    if (!(await fileExists(skillFilePath))) {
      throw new Error(`${SKILL_FILE_NAME} not found in ${skillDirPath}`);
    }

    const fileContent = await readFileContent(skillFilePath);
    const { frontmatter, body: content } = parseFrontmatter(fileContent, skillFilePath);

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
      frontmatter,
      body: content.trim(),
      otherFiles,
      global,
    };
  }

  protected requireMainFileFrontmatter(): Record<string, unknown> {
    if (!this.mainFile?.frontmatter) {
      throw new Error(`Frontmatter is not defined in ${join(this.relativeDirPath, this.dirName)}`);
    }
    return this.mainFile.frontmatter;
  }
}
