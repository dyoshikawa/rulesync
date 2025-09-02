import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

/**
 * ClineIgnore represents ignore patterns for the Cline VSCode extension.
 *
 * Based on the Cline specification:
 * - File location: Workspace root folder only (.clineignore)
 * - Syntax: Same as .gitignore
 * - Immediate reflection when saved
 * - Complete blocking of file access for ignored patterns
 * - Shows lock icon (🔒) for ignored files in listings
 */
export class ClineIgnore extends ToolIgnore {
  /**
   * Convert ClineIgnore to RulesyncIgnore format
   */
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  /**
   * Create ClineIgnore from RulesyncIgnore
   */
  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): ClineIgnore {
    const body = rulesyncIgnore.getFileContent();

    return new ClineIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".clineignore",
      fileContent: body,
    });
  }

  /**
   * Load ClineIgnore from .clineignore file
   */
  static async fromFile(): Promise<ClineIgnore> {
    const fileContent = await readFileContent(".clineignore");

    return new ClineIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".clineignore",
      fileContent,
    });
  }
}
