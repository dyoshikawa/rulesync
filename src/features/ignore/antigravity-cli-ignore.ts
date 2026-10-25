import { ANTIGRAVITY_IGNORE_FILE_NAME } from "../../constants/antigravity-cli-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import type { ToolIgnoreSettablePaths } from "./tool-ignore.js";

/**
 * Antigravity CLI is the successor to Gemini CLI and is built on the same
 * engine, so it reads the project-root `.geminiignore` file (same conventions as
 * `.gitignore`) to exclude files and directories from the agent's context,
 * reusing the `.geminiignore` conventions from the Gemini-CLI lineage.
 */
export class AntigravityCliIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANTIGRAVITY_IGNORE_FILE_NAME,
    };
  }
}
