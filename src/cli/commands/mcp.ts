import { FastMCP } from "fastmcp";

import { rulesyncTool } from "../../mcp/tools.js";
import { logger } from "../../utils/logger.js";

/**
 * MCP command that starts the MCP server
 */
export async function mcpCommand({ version }: { version: string }): Promise<void> {
  const server = new FastMCP({
    name: "Rulesync MCP Server",
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    version: version as `${number}.${number}.${number}`,
    instructions:
      "This server handles Rulesync files including rules, commands, MCP, ignore files, subagents and skills for any AI agents. It should be used when you need those files.",
  });

  server.addTool(rulesyncTool);

  // Start server with stdio transport (for spawned processes)
  logger.info("Rulesync MCP server started via stdio");

  // Start the server - this blocks execution and runs the MCP server
  // The void operator explicitly marks this as intentionally not awaited
  void server.start({
    transportType: "stdio",
  });
}
