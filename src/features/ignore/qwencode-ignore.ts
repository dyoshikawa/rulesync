import { QWENCODE_IGNORE_FILE_NAME } from "../../constants/qwencode-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths } from "./tool-ignore.js";

export class QwencodeIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    // Qwen Code reads `.qwenignore` from the project root (not `.geminiignore`,
    // despite being a Gemini CLI fork). Emitting `.geminiignore` left the file inert.
    // https://qwenlm.github.io/qwen-code-docs/en/users/configuration/qwen-ignore
    return {
      relativeDirPath: ".",
      relativeFilePath: QWENCODE_IGNORE_FILE_NAME,
    };
  }
}
