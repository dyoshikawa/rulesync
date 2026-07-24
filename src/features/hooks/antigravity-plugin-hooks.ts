import { ANTIGRAVITY_PLUGIN_HOOKS_FILE_NAME } from "../../constants/plugin-paths.js";
import { AntigravityIdeHooks } from "./antigravity-hooks.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

export class AntigravityPluginHooks extends AntigravityIdeHooks {
  static override getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANTIGRAVITY_PLUGIN_HOOKS_FILE_NAME,
    };
  }
}
