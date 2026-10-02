import { DEVIN_PLUGIN_HOOKS_FILE_NAME } from "../../constants/plugin-paths.js";
import { DevinHooks } from "./devin-hooks.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

/**
 * Hooks inside a Devin plugin bundle (`<plugin>/hooks.json`). The file is the
 * same bare event map as `.devin/hooks.v1.json` (no `hooks` wrapper key), as
 * in Cognition's plugin templates. Devin documents no plugin-root variable
 * for hook commands, so they are written verbatim, like for the `devin`
 * target.
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 * @see https://github.com/CognitionAI/plugin-template/blob/main/plugins/kitchen-sink/hooks.json
 */
export class DevinPluginHooks extends DevinHooks {
  static override getSettablePaths(): ToolHooksSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: DEVIN_PLUGIN_HOOKS_FILE_NAME };
  }
}
