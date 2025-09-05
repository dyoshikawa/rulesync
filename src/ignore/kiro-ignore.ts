import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
} from "./tool-ignore.js";

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

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<KiroIgnore> {
    const fileContent = await readFileContent(join(baseDir, ".aiignore"));

    return new KiroIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".aiignore",
      fileContent,
      validate,
    });
  }
}
