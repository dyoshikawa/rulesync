import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type {
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
} from "./tool-ignore.js";
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

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<QwencodeIgnore> {
    const fileContent = await readFileContent(join(baseDir, ".geminiignore"));

    return new QwencodeIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".geminiignore",
      fileContent,
      validate,
    });
  }
}
