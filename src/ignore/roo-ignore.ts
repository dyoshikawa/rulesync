import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

/**
 * RooIgnore represents ignore patterns for the Roo Code AI coding assistant.
 *
 * Based on the Roo Code specification:
 * - File location: Workspace root folder only (.rooignore)
 * - Syntax: Same as .gitignore (fully compatible)
 * - Immediate reflection when saved (no restart required)
 * - Self-protection: .rooignore itself is always implicitly ignored
 * - Strict blocking: Both read and write operations are prohibited
 * - Visual indicators: Shows lock icon (🔒) when showRooIgnoredFiles=true
 * - Bypass mechanism: Explicit @/path/to/file mentions bypass ignore rules
 * - Support started: Official support in Roocode 3.8 (2025-03-13)
 */
export class RooIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".rooignore",
    };
  }
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): RooIgnore {
    return new RooIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<RooIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new RooIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }
}
