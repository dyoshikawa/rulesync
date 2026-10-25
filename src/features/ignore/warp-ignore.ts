import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { WARP_IGNORE_FILE_NAME } from "../../constants/warp-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Ignore generator for Warp.
 *
 * Warp excludes files/folders from agent codebase indexing and context via a
 * project-scoped `.warpindexingignore` file at the repository root, using
 * gitignore syntax. Warp documents no global/user-scope ignore file, so this is
 * project-only.
 * @see https://docs.warp.dev/agent-platform/capabilities/codebase-context/
 */
export class WarpIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: WARP_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      outputRoot: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: this.fileContent,
    });
  }
}
