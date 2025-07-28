import type { RulesyncMcpServer } from "../../types/mcp.js";

export async function generateJunieMcpConfiguration(
  _servers: Record<string, RulesyncMcpServer>,
  _dir: string,
): Promise<Array<{ filepath: string; content: string }>> {
  // Junie doesn't support MCP configuration yet
  return [];
}
