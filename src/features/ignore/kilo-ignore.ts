import { KILO_IGNORE_FILE_NAME, KILO_LEGACY_GLOBAL_DIR } from "../../constants/kilo-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

/**
 * KiloIgnore represents ignore patterns for the Kilo Code VSCode extension.
 *
 * Based on the Kilo Code specification:
 * - File location: workspace root (.kilocodeignore) for project scope, and
 *   `~/.kilocode/.kilocodeignore` for global scope. Kilo merges the global
 *   patterns first and the project ones after, so the project file wins.
 * - Syntax: Same as .gitignore
 * - Immediate reflection when saved
 * - Complete blocking of file access for ignored patterns
 * - Shows lock icon for ignored files in listings
 *
 * Kilo reads `.kilocodeignore` (not `.kiloignore`), so emitting `.kiloignore`
 * left the file inert. https://kilo.ai/docs/customize/context/kilocodeignore
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/opencode/src/kilocode/ignore-migrator.ts
 */
export class KiloIgnore extends PlainToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? KILO_LEGACY_GLOBAL_DIR : ".",
      relativeFilePath: KILO_IGNORE_FILE_NAME,
    };
  }
}
