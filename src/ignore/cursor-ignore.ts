import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
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
      relativeFilePath: ".rulesyncignore",
      fileContent: this.fileContent,
    });
  }

  static fromRulesyncIgnore({
    baseDir = ".",
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
    baseDir = ".",
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
