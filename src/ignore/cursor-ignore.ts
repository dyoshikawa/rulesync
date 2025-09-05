import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
} from "./tool-ignore.js";

export class CursorIgnore extends ToolIgnore {
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
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore",
      fileContent: body,
    });
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<CursorIgnore> {
    const fileContent = await readFileContent(join(baseDir, ".cursorignore"));

    return new CursorIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore",
      fileContent,
      validate,
    });
  }
}
