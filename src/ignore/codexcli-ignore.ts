import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import { ToolIgnore, ToolIgnoreFromRulesyncIgnoreParams, ToolIgnoreParams } from "./tool-ignore.js";

export type CodexcliIgnoreParams = {
  patterns?: string[];
} & Omit<ToolIgnoreParams, "patterns">;

export class CodexcliIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): CodexcliIgnore {
    const fileContent = rulesyncIgnore.getFileContent();

    return new CodexcliIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".codexignore",
      fileContent: fileContent,
      validate: true, // Skip validation to allow empty patterns
    });
  }

  static async fromFile(): Promise<CodexcliIgnore> {
    const fileContent = await readFileContent(".codexignore");

    return new CodexcliIgnore({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: ".codexignore",
      fileContent: fileContent,
      validate: true, // Skip validation to allow empty patterns
    });
  }
}
