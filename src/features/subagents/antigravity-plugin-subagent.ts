import { ANTIGRAVITY_PLUGIN_AGENTS_DIR } from "../../constants/plugin-paths.js";
import { ToolTarget } from "../../types/tool-targets.js";
import {
  ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS,
  AntigravitySharedSubagent,
} from "./antigravity-shared-subagent.js";
import type { ToolSubagentSettablePaths } from "./tool-subagent.js";

/**
 * Custom agent inside an Antigravity plugin bundle
 * (`<plugin_name>/agents/<name>.md`). Plugin bundles are project-scope output
 * only; they are staged into `~/.gemini/antigravity-cli/plugins/` by the user.
 *
 * @see https://antigravity.google/docs/cli/plugins
 */
export class AntigravityPluginSubagent extends AntigravitySharedSubagent {
  protected static override getToolTarget(): ToolTarget {
    return "antigravity-plugin";
  }

  // The bundle is not the shared `.agents/agents/` file, so the `gitlabduo`
  // and `musecode` sections merged there are not read here.
  protected static override getReadSectionKeys(): ToolTarget[] {
    return [...ANTIGRAVITY_SHARED_SUBAGENT_SECTION_KEYS, "antigravity-plugin"];
  }

  static override getSettablePaths(): ToolSubagentSettablePaths {
    return { relativeDirPath: ANTIGRAVITY_PLUGIN_AGENTS_DIR };
  }
}
