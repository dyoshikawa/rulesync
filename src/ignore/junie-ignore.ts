import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";

export class JunieIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): JunieIgnore {
    return new JunieIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".junieignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile(): Promise<JunieIgnore> {
    const fileContent = await readFileContent(".junieignore");

    return new JunieIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".junieignore",
      fileContent,
    });
  }
}
