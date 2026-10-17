import { StdioServerTransport } from "@modelcontextprotocol/sdk/server/stdio.js";

import { createRulesyncMcpServer } from "../../mcp/server.js";
import type { Logger } from "../../utils/logger.js";

/**
 * MCP command that starts the MCP server
 */
export async function mcpCommand(logger: Logger, { version }: { version: string }): Promise<void> {
  const server = createRulesyncMcpServer({ version });

  // Start server with stdio transport (for spawned processes)
  logger.info("Rulesync MCP server started via stdio");

  // The transport keeps reading stdin, so the process stays alive until the
  // client closes the pipe.
  await server.connect(new StdioServerTransport());
}
