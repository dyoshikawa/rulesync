import { DEVIN_PLUGIN_HOOKS_FILE_NAME } from "../../constants/plugin-paths.js";
import { DEVIN_CONVERTER_CONFIG, DevinHooks } from "./devin-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

/**
 * Plugin hook scripts ship inside the plugin, so a dot-relative command is
 * anchored to the plugin install directory rather than run against the
 * consumer's workspace. Devin CLI v3000.5.20+ sets `DEVIN_PLUGIN_ROOT` in the
 * environment of hooks contributed by a plugin, and runs `command` as a shell
 * command, so the quoted `"$DEVIN_PLUGIN_ROOT"/...` form expands there. Bare
 * commands such as `npx prettier --write` are left intact.
 *
 * `DEVIN_PLUGIN_ROOT` is chosen over the shorter `PLUGIN_ROOT` (v3000.11.92+)
 * because it is the Devin-native name and works on older CLI versions. On
 * import, `PLUGIN_ROOT` and `CLAUDE_PLUGIN_ROOT` (which Devin also sets for
 * Claude Code plugin hooks) are converted back to `./` too.
 *
 * @see https://docs.devin.ai/cli/changelog/stable
 * @see https://docs.devin.ai/cli/extensibility/hooks/overview
 */
export const DEVIN_PLUGIN_CONVERTER_CONFIG: ToolHooksConverterConfig = {
  ...DEVIN_CONVERTER_CONFIG,
  projectDirVar: "$DEVIN_PLUGIN_ROOT",
  prefixDotRelativeCommandsOnly: true,
  importedProjectDirVarAliases: ["$PLUGIN_ROOT", "$CLAUDE_PLUGIN_ROOT"],
};

/**
 * Hooks inside a Devin plugin bundle (`<plugin>/hooks.json`). The file is the
 * same bare event map as `.devin/hooks.v1.json` (no `hooks` wrapper key), as
 * in Cognition's plugin templates. Unlike the `devin` target, `./`-relative
 * commands are anchored to `$DEVIN_PLUGIN_ROOT` (see
 * `DEVIN_PLUGIN_CONVERTER_CONFIG`).
 *
 * @see https://docs.devin.ai/cli/extensibility/plugins/overview
 * @see https://github.com/CognitionAI/plugin-template/blob/main/plugins/kitchen-sink/hooks.json
 */
export class DevinPluginHooks extends DevinHooks {
  static override getSettablePaths(): ToolHooksSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: DEVIN_PLUGIN_HOOKS_FILE_NAME };
  }

  protected static override getConverterConfig(): ToolHooksConverterConfig {
    return DEVIN_PLUGIN_CONVERTER_CONFIG;
  }
}
