import { TRAE_DIR, TRAE_IGNORE_FILE_NAME } from "../../constants/trae-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

/**
 * Trae ignore file implementation.
 *
 * Trae reads `.trae/.ignore` (gitignore syntax) as a supplement to
 * `.gitignore` when it indexes the codebase; ignored files are also left out
 * of `#Workspace` / `#Folder` context. There is no user-level ignore file, so
 * only project scope is supported.
 *
 * @see https://docs.trae.ai/ide/ignore-files?_lang=en
 */
export class TraeIgnore extends PlainToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: TRAE_DIR,
      relativeFilePath: TRAE_IGNORE_FILE_NAME,
    };
  }
}
