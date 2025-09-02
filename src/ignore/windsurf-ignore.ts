import { RulesyncIgnore } from "./rulesync-ignore.js";
import type { ToolIgnoreFromRulesyncIgnoreParams } from "./tool-ignore.js";
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
}
