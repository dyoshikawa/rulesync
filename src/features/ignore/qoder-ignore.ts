import { QODER_IGNORE_FILE_NAME } from "../../constants/qoder-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths } from "./tool-ignore.js";

export class QoderIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    // Qoder IDE reads `.qoderignore` (gitignore syntax) from the project root
    // and excludes the listed paths from codebase indexing.
    // https://docs.qoder.com/user-guide/indexing
    return {
      relativeDirPath: ".",
      relativeFilePath: QODER_IGNORE_FILE_NAME,
    };
  }
}
