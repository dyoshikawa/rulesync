import { RULESYNC_MCP_RELATIVE_FILE_PATH } from "../constants/rulesync-paths.js";
import { RulesyncMcp } from "../features/mcp/rulesync-mcp.js";
import { createJsoncSourceFileTools } from "./jsonc-source-file-tools.js";

/**
 * Tool definitions for MCP-related operations
 */
export const mcpTools = createJsoncSourceFileTools({
  toolNameSuffix: "Mcp",
  label: "MCP",
  sizeLabel: "MCP",
  relativeFilePath: RULESYNC_MCP_RELATIVE_FILE_PATH,
  source: RulesyncMcp,
});
