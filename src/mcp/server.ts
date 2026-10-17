import { McpServer } from "@modelcontextprotocol/sdk/server/mcp.js";

import { rulesyncTool } from "./tools.js";

const RULESYNC_MCP_SERVER_INSTRUCTIONS =
  "This server handles Rulesync files including rules, commands, MCP, ignore files, subagents and skills for any AI agents. It should be used when you need those files.";

/**
 * Build the Rulesync MCP server with its single `rulesyncTool` registered.
 * The caller connects it to a transport.
 */
export function createRulesyncMcpServer({ version }: { version: string }): McpServer {
  const server = new McpServer(
    { name: "Rulesync MCP Server", version },
    { instructions: RULESYNC_MCP_SERVER_INSTRUCTIONS },
  );

  server.registerTool(
    rulesyncTool.name,
    { description: rulesyncTool.description, inputSchema: rulesyncTool.parameters },
    // A thrown error is returned to the client as an `isError` result carrying
    // the error message, so the model sees why the call failed.
    async (args) => ({
      content: [{ type: "text", text: await rulesyncTool.execute(args) }],
    }),
  );

  return server;
}
