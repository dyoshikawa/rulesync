import { CODEBUFF_IGNORE_FILE_NAME } from "../../constants/codebuff-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

/**
 * Codebuff (Freebuff) ignore file implementation.
 *
 * Codebuff reads `.codebuffignore` beside `.gitignore` in the project, with
 * gitignore syntax (`!` negation included), to keep files out of the agent's
 * file tree. There is no user-level ignore file, so only project scope is
 * supported.
 *
 * @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/util/project-ignore.ts
 */
export class CodebuffIgnore extends PlainToolIgnore {
  static getSettablePaths(_params: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    // Project scope only; the processor never asks for global paths.
    return {
      relativeDirPath: ".",
      relativeFilePath: CODEBUFF_IGNORE_FILE_NAME,
    };
  }
}
