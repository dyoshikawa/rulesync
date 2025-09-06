import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type {
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export type AmazonqcliIgnoreParams = ToolIgnoreParams;

/**
 * Amazon Q CLI Ignore implementation
 *
 * Note: As of current version, Amazon Q CLI does not have native ignore file support.
 * This implementation follows the proposed .q-ignore specification based on community requests.
 * See GitHub Issue #205 for the feature request status.
 *
 * The implementation supports:
 * - Proposed .q-ignore file format (primary community request)
 * - Alternative .amazonqignore file format
 * - Fallback to proposed patterns when no ignore files exist
 * - Integration with Amazon Q's context management system
 */
export class AmazonqcliIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".amazonqignore",
    };
  }

  /**
   * Convert to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  /**
   * Create AmazonqcliIgnore from RulesyncIgnore
   * Supports conversion from unified rulesync format to Amazon Q CLI specific format
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AmazonqcliIgnore {
    const body = rulesyncIgnore.getFileContent();

    return new AmazonqcliIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body,
    });
  }

  /**
   * Create AmazonqcliIgnore from file path
   * Supports both proposed .q-ignore and .amazonqignore formats
   */
  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<AmazonqcliIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new AmazonqcliIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }
}
