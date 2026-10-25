import { ANDROIDSTUDIO_IGNORE_FILE_NAME } from "../../constants/androidstudio-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Ignore generator for Gemini in Android Studio.
 *
 * Gemini reads `.aiexclude` files (gitignore syntax) anywhere in the project;
 * each one applies to the files at or below its directory and blocks both the
 * chat and the editor AI features such as code completion. Rulesync writes the
 * project-root file only. There is no user-level variant.
 *
 * @see https://developer.android.com/studio/gemini/aiexclude
 */
export class AndroidstudioIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANDROIDSTUDIO_IGNORE_FILE_NAME,
    };
  }
}
