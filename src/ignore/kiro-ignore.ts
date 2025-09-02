import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

export class KiroIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): KiroIgnore {
    return new KiroIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".aiignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile(): Promise<KiroIgnore> {
    const fileContent = await readFileContent(".aiignore");

    return new KiroIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".aiignore",
      fileContent,
    });
  }
}
