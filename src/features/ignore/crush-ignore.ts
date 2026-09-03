import { join } from "node:path";

import { CRUSH_IGNORE_FILE_NAME } from "../../constants/crush-paths.js";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
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
 * Ignore generator for Crush.
 *
 * Crush excludes files from tool access via a `.crushignore` file, read
 * hierarchically (root and any subdirectory, the same way it walks
 * `.gitignore`) using gitignore syntax. Crush documents no global/user-scope
 * ignore file, so this is project-only.
 * @see https://github.com/charmbracelet/crush/blob/main/internal/fsext/fileutil.go
 */
export class CrushIgnore extends ToolIgnore {
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

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): CrushIgnore {
    const body = rulesyncIgnore.getFileContent();

    return new CrushIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body,
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<CrushIgnore> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CrushIgnore({
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
  }: ToolIgnoreForDeletionParams): CrushIgnore {
    return new CrushIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
