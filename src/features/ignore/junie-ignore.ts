import { JUNIE_IGNORE_FILE_NAME } from "../../constants/junie-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths } from "./tool-ignore.js";

export class JunieIgnore extends PlainToolIgnore {
  static getSettablePaths(): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: JUNIE_IGNORE_FILE_NAME,
    };
  }
}
