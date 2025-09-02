import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

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
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): RooIgnore {
    return new RooIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".rooignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile(): Promise<RooIgnore> {
    const fileContent = await readFileContent(".rooignore");

    return new RooIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".rooignore",
      fileContent,
    });
  }
}
