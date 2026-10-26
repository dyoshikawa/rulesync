import { CRUSH_IGNORE_FILE_NAME } from "../../constants/crush-paths.js";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Ignore generator for Crush.
 *
 * Crush excludes files from tool access via a `.crushignore` file, read
 * hierarchically (root and any subdirectory, the same way it walks
 * `.gitignore`) using gitignore syntax. Crush documents no global/user-scope
 * ignore file, so this is project-only.
 * @see https://github.com/charmbracelet/crush/blob/main/internal/fsext/fileutil.go
 */
export class CrushIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: CRUSH_IGNORE_FILE_NAME,
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
