import { LETTACODE_DIR, LETTACODE_IGNORE_FILE_NAME } from "../../constants/lettacode-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

/**
 * Letta Code ignore file implementation.
 *
 * Letta Code reads `.letta/.lettaignore` at the project root to exclude files
 * and directories from its indexed `@` file search: one glob per line, `#`
 * comments, and no `!` negation (such lines are skipped by Letta Code). There
 * is no user-level ignore file, so only project scope is supported.
 *
 * @see https://docs.letta.com/reference/settings/index.md
 */
export class LettacodeIgnore extends PlainToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: LETTACODE_DIR,
      relativeFilePath: LETTACODE_IGNORE_FILE_NAME,
    };
  }
}
