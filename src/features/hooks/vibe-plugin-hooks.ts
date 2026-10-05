import {
  VIBE_PLUGIN_EXTENSION_DIR,
  VIBE_PLUGIN_HOOKS_FILE_NAME,
} from "../../constants/plugin-paths.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";
import { VibeHooks } from "./vibe-hooks.js";

/**
 * Hooks inside a Vibe plugin bundle (`<plugin>/ai.mistral.vibe/hooks.toml`).
 * Vibe loads the file with the same `load_hooks_file` as `.vibe/hooks.toml`,
 * so the `[[hooks]]` array is unchanged. Plugin hooks run with the plugin root
 * as the working directory and `PLUGIN_ROOT` / `PLUGIN_DATA` in the
 * environment, so a relative command such as `./scripts/check.sh` already
 * resolves inside the bundle and is written as is. The file is loaded only
 * when `plugin.json` declares the `ai.mistral.vibe` extension.
 *
 * @see https://github.com/mistralai/mistral-vibe/blob/v2.25.8/vibe/core/plugins/_native.py
 */
export class VibePluginHooks extends VibeHooks {
  static override getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: VIBE_PLUGIN_EXTENSION_DIR,
      relativeFilePath: VIBE_PLUGIN_HOOKS_FILE_NAME,
    };
  }
}
