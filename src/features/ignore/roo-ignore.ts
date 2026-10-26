import { ROO_IGNORE_FILE_NAME } from "../../constants/roo-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

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
export class RooIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ROO_IGNORE_FILE_NAME,
    };
  }
}
