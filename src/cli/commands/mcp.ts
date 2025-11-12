import { FastMCP } from "fastmcp";
import { ruleTools } from "../../mcp/rules.js";
import { logger } from "../../utils/logger.js";

/**
 * MCP command that starts the MCP server
 */
export async function mcpCommand({ version }: { version: string }): Promise<void> {
  const server = new FastMCP({
    name: "rulesync-mcp-server",
    // Type assertion is safe here because version comes from package.json which follows semver
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    version: version as `${number}.${number}.${number}`,
  });

  // Register rule tools
  server.addTool(ruleTools.listRules);
  server.addTool(ruleTools.getRule);
  server.addTool(ruleTools.putRule);
  server.addTool(ruleTools.deleteRule);

  // Start server with stdio transport (for spawned processes)
  logger.info("Rulesync MCP server started via stdio");

  // Start the server - this blocks execution and runs the MCP server
  // The void operator explicitly marks this as intentionally not awaited
  void server.start({
    transportType: "stdio",
  });
}
