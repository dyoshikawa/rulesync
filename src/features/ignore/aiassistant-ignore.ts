import { AIASSISTANT_IGNORE_FILE_NAME } from "../../constants/aiassistant-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Ignore generator for JetBrains AI Assistant.
 *
 * AI Assistant honours the JetBrains-wide `.aiignore` file (gitignore syntax) at
 * the project root — the same file Junie uses.
 *
 * @see https://www.jetbrains.com/help/ai-assistant/configure-project-rules.html
 */
export class AiassistantIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: AIASSISTANT_IGNORE_FILE_NAME,
    };
  }
}
