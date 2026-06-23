import { join } from "node:path";

import { AIASSISTANT_IGNORE_FILE_NAME } from "../../constants/aiassistant-paths.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncIgnore } from "./rulesync-ignore.js";
import {
  ToolIgnore,
  ToolIgnoreForDeletionParams,
  ToolIgnoreFromFileParams,
  ToolIgnoreFromRulesyncIgnoreParams,
  ToolIgnoreSettablePaths,
} from "./tool-ignore.js";

/**
 * Ignore generator for JetBrains AI Assistant.
 *
 * AI Assistant honours the JetBrains-wide `.aiignore` file (gitignore syntax) at
 * the project root — the same file Junie uses.
 *
 * @see https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html
 */
export class AiassistantIgnore extends ToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: AIASSISTANT_IGNORE_FILE_NAME,
    };
  }

  toRulesyncIgnore(): RulesyncIgnore {
    return this.toRulesyncIgnoreDefault();
  }

  static fromRulesyncIgnore({
    outputRoot = process.cwd(),
    rulesyncIgnore,
  }: ToolIgnoreFromRulesyncIgnoreParams): AiassistantIgnore {
    return new AiassistantIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: rulesyncIgnore.getFileContent(),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolIgnoreFromFileParams): Promise<AiassistantIgnore> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new AiassistantIgnore({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolIgnoreForDeletionParams): AiassistantIgnore {
    return new AiassistantIgnore({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
    });
  }
}
