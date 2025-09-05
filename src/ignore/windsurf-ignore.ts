import { join } from "node:path";
import { readFileContent } from "../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import type {
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
} from "./tool-ignore.js";
import { ToolIgnore } from "./tool-ignore.js";

/**
 * Windsurf AI code editor ignore file implementation
 * Uses .codeiumignore file with gitignore-compatible syntax
 * Automatically respects .gitignore patterns and has built-in defaults for node_modules/ and hidden files
 */
export class WindsurfIgnore extends ToolIgnore {
  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    baseDir = ".",
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): WindsurfIgnore {
    return new WindsurfIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".codeiumignore",
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    baseDir = ".",
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<WindsurfIgnore> {
    const fileContent = await readFileContent(join(baseDir, ".codeiumignore"));

    return new WindsurfIgnore({
      baseDir,
      relativeDirPath: ".",
      relativeFilePath: ".codeiumignore",
      fileContent,
      validate,
    });
  }
}
