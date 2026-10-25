import { TABNINE_IGNORE_FILE_NAME } from "../../constants/tabnine-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * TabnineIgnore represents the `.tabnineignore` file of Tabnine CLI.
 *
 * - File location: project root only (`.tabnineignore`); no user-scope
 *   variant is documented, so the feature is project-only.
 * - Syntax: the same as `.gitignore`.
 * - Matching files are excluded from the CLI's file searches and directory
 *   listings while `context.fileFiltering.respectGeminiIgnore` (the default)
 *   is enabled.
 *
 * @see https://docs.tabnine.com/main/getting-started/tabnine-cli/features/settings/settings-reference
 */
export class TabnineIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: TABNINE_IGNORE_FILE_NAME,
    };
  }
}
