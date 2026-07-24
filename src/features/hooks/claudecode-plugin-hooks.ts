import {
  CLAUDECODE_PLUGIN_HOOKS_DIR,
  CLAUDECODE_PLUGIN_HOOKS_FILE_NAME,
} from "../../constants/plugin-paths.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

export class ClaudecodePluginHooks extends ClaudecodeHooks {
  override isDeletable(): boolean {
    return true;
  }

  static override getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_PLUGIN_HOOKS_DIR,
      relativeFilePath: CLAUDECODE_PLUGIN_HOOKS_FILE_NAME,
    };
  }
}
