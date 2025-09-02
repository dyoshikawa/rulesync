import { readFile } from "node:fs/promises";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

export class QwencodeIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): QwencodeIgnore {
    return new QwencodeIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".geminiignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile(): Promise<QwencodeIgnore> {
    const fileContent = await readFile(".geminiignore", "utf-8");

    return new QwencodeIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".geminiignore",
      fileContent,
    });
  }
}
