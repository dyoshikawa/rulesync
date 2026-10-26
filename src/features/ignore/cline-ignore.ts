import { CLINE_IGNORE_FILE_NAME } from "../../constants/cline-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

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
export class ClineIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: CLINE_IGNORE_FILE_NAME,
    };
  }
}
