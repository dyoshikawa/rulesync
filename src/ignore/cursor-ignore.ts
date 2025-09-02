import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

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

  static async fromFile(): Promise<CursorIgnore> {
    const fileContent = await readFileContent(".cursorignore");

    return new CursorIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".cursorignore",
      fileContent,
    });
  }
}
