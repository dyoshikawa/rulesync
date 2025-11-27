import { join } from "node:path";
import { RULESYNC_AIIGNORE_RELATIVE_FILE_PATH } from "../../constants/rulesync-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

export class CursorIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore",
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return new RulesyncIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_AIIGNORE_RELATIVE_FILE_PATH,
      fileContent: this.fileContent,
    });
  }

  static fromRulesyncIgnore({
    baseDir = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): CursorIgnore {
    const body = rulesyncIgnore.getFileContent();

    return new CursorIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: body,
    });
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<CursorIgnore> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CursorIgnore({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }
}
