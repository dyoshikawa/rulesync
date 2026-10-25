import {
  KIRO_GLOBAL_IGNORE_FILE_NAME,
  KIRO_IGNORE_FILE_NAME,
  KIRO_SETTINGS_DIR_PATH,
} from "../../constants/kiro-paths.js";
import { PlainToolIgnore } from "./plain-tool-ignore.js";
import { ToolIgnoreSettablePaths, ToolIgnoreSettablePathsParams } from "./tool-ignore.js";

export class KiroIgnore extends PlainToolIgnore {
  static getSettablePaths({
    global = false,
  }: ToolIgnoreSettablePathsParams = {}): ToolIgnoreSettablePaths {
    return {
      relativeDirPath: global ? KIRO_SETTINGS_DIR_PATH : ".",
      relativeFilePath: global ? KIRO_GLOBAL_IGNORE_FILE_NAME : KIRO_IGNORE_FILE_NAME,
    };
  }
}
