import { readFile } from "node:fs/promises";
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
    const fileContent = await readFile(".aiignore", "utf-8");

    return new KiroIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".aiignore",
      fileContent,
    });
  }
}
