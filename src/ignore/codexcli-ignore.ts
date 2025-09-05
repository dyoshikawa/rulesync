import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreParams,
} from "./tool-ignore.js";

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

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<CodexcliIgnore> {
    const fileContent = await readFileContent(join(baseDir, ".codexignore"));

    return new CodexcliIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".codexignore",
      fileContent: fileContent,
      validate,
    });
  }
}
