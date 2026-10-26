import { JUNIE_MCP_DIR_PATH, JUNIE_MCP_FILE_NAME } from "../../constants/junie-paths.js";
import { AiassistantMcp } from "./aiassistant-mcp.js";
import { ToolMcpSettablePaths } from "./tool-mcp.js";

/**
 * Junie reads the same `mcp.json` format as JetBrains AI Assistant, so only
 * the paths differ.
 */
export class JunieMcp extends AiassistantMcp {
  static override getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The relative path is identical for both project and user scope. In global
    // mode the same path is resolved under the user home (`~/.junie/mcp/mcp.json`).
    return {
      relativeDirPath: JUNIE_MCP_DIR_PATH,
      relativeFilePath: JUNIE_MCP_FILE_NAME,
    };
  }
}
