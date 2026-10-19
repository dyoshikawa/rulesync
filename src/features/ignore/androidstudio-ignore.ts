import { join } from "node:path";

import { ANDROIDSTUDIO_IGNORE_FILE_NAME } from "../../constants/androidstudio-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

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
export class AndroidstudioIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANDROIDSTUDIO_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AndroidstudioIgnore {
    return new AndroidstudioIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<AndroidstudioIgnore> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new AndroidstudioIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): AndroidstudioIgnore {
    return new AndroidstudioIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
