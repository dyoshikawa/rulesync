import { FastMCP } from "fastmcp";
import { commandTools } from "../../mcp/commands.js";
import { ignoreTools } from "../../mcp/ignore.js";
import { mcpTools } from "../../mcp/mcp.js";
import { ruleTools } from "../../mcp/rules.js";
import { subagentTools } from "../../mcp/subagents.js";
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
      "This server handles Rulesync files including rules, commands, MCP, ignore files, and subagents for any AI agents. It should be used when you need those files.",
  });

  // Register rule tools
  server.addTool(ruleTools.listRules);
  server.addTool(ruleTools.getRule);
  server.addTool(ruleTools.putRule);
  server.addTool(ruleTools.deleteRule);

  // Register command tools
  server.addTool(commandTools.listCommands);
  server.addTool(commandTools.getCommand);
  server.addTool(commandTools.putCommand);
  server.addTool(commandTools.deleteCommand);

  // Register subagent tools
  server.addTool(subagentTools.listSubagents);
  server.addTool(subagentTools.getSubagent);
  server.addTool(subagentTools.putSubagent);
  server.addTool(subagentTools.deleteSubagent);

  // Register ignore tools
  server.addTool(ignoreTools.getIgnoreFile);
  server.addTool(ignoreTools.putIgnoreFile);
  server.addTool(ignoreTools.deleteIgnoreFile);

  // Register MCP tools
  server.addTool(mcpTools.getMcpFile);
  server.addTool(mcpTools.putMcpFile);
  server.addTool(mcpTools.deleteMcpFile);

  // Start server with stdio transport (for spawned processes)
  logger.info("Rulesync MCP server started via stdio");

  // Start the server - this blocks execution and runs the MCP server
  // The void operator explicitly marks this as intentionally not awaited
  void server.start({
    transportType: "stdio",
  });
}
