import {
  CLAUDECODE_PLUGIN_HOOKS_DIR,
  CLAUDECODE_PLUGIN_HOOKS_FILE_NAME,
} from "../../constants/plugin-paths.js";
import { ClaudecodeHooks } from "./claudecode-hooks.js";
import type { ToolHooksConverterConfig } from "./tool-hooks-converter.js";
import type { ToolHooksSettablePaths } from "./tool-hooks.js";

export class ClaudecodePluginHooks extends ClaudecodeHooks {
  override isDeletable(): boolean {
    return true;
  }

  /**
   * Plugin hook scripts ship inside the plugin, so their commands must resolve
   * against the plugin install directory rather than the consumer's project
   * root. Upstream documents `"${CLAUDE_PLUGIN_ROOT}"/scripts/format-code.sh`;
   * `$CLAUDE_PROJECT_DIR` would expand to a path in the consumer's own repo,
   * where the bundled script does not exist.
   *
   * @see https://code.claude.com/docs/en/plugins-reference
   */
  static override getConverterConfig(): ToolHooksConverterConfig {
    return { ...super.getConverterConfig(), projectDirVar: "$CLAUDE_PLUGIN_ROOT" };
  }

  static override getSettablePaths(): ToolHooksSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_PLUGIN_HOOKS_DIR,
      relativeFilePath: CLAUDECODE_PLUGIN_HOOKS_FILE_NAME,
    };
  }
}
