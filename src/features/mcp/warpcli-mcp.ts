import { WARP_MCP_FILE_NAME, warpcliConfigDir } from "../../constants/warp-paths.js";
import { ToolMcpSettablePaths } from "./tool-mcp.js";
import { WarpMcp } from "./warp-mcp.js";

/**
 * MCP generator for the standalone Warp Agent CLI (the `warp` binary).
 *
 * The CLI "keeps its own MCP server configuration, separate from the Warp
 * app's" in a `.mcp.json` beside its `settings.toml`, using the same
 * `mcpServers` format as the app's file-based MCP servers — so all behavior
 * (including `cwd` ⇄ `working_directory`) is shared with {@link WarpMcp}. The
 * CLI "reads MCP servers from its global config file only. Project-scoped MCP
 * config files in repositories are not detected", so this target is
 * global-only; the app's project `.warp/.mcp.json` stays with the `warp`
 * target.
 *
 * @see https://docs.warp.dev/agents/cli/configuration/
 */
export class WarpcliMcp extends WarpMcp {
  static override getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: warpcliConfigDir(),
      relativeFilePath: WARP_MCP_FILE_NAME,
    };
  }
}
