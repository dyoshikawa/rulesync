import { ANTIGRAVITY_PLUGIN_MCP_FILE_NAME } from "../../constants/plugin-paths.js";
import { AntigravityIdeMcp } from "./antigravity-ide-mcp.js";
import type { ToolMcpSettablePaths } from "./tool-mcp.js";

export class AntigravityPluginMcp extends AntigravityIdeMcp {
  static override getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: ANTIGRAVITY_PLUGIN_MCP_FILE_NAME,
    };
  }
}
