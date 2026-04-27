import { join } from "node:path";

import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

/**
 * KiloIgnore represents ignore patterns for the Kilo Code VSCode extension.
 *
 * Based on the Kilo Code specification:
 * - File location: Workspace root folder only (.kiloignore)
 * - Syntax: Same as .gitignore
 * - Immediate reflection when saved
 * - Complete blocking of file access for ignored patterns
 * - Shows lock icon for ignored files in listings
 */
export class KiloIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".kiloignore",
    };
  }

  /**
   * Convert KiloIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  /**
   * Create KiloIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): KiloIgnore {
    const body = rulesyncIgnore.getFileContent();

    return new KiloIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body,
    });
  }

  /**
   * Load KiloIgnore from .kiloignore file
   */
  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<KiloIgnore> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new KiloIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): KiloIgnore {
    return new KiloIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
