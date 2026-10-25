import { CONTINUE_DIR, CONTINUE_IGNORE_FILE_NAME } from "../../constants/continue-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

/**
 * Continue ignore file implementation.
 *
 * - Project scope: the workspace-root `.continueignore`, which follows the
 *   exact same rules as `.gitignore` and is layered on top of it.
 * - Global scope: `~/.continue/.continueignore`, respected for all workspaces.
 *
 * @see https://docs.continue.dev/reference/deprecated-codebase
 */
export class ContinueIgnore extends PlainToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? CONTINUE_DIR : ".",
      relativeFilePath: CONTINUE_IGNORE_FILE_NAME,
    };
  }
}
