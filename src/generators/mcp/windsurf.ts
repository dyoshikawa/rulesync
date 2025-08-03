import { join } from "node:path";
import type { RulesyncMcpServer } from "../../types/mcp.js";

export async function generateWindsurfMcpConfiguration(
  servers: Record<string, RulesyncMcpServer>,
  baseDir: string,
): Promise<Array<{ filepath: string; content: string }>> {
  // Windsurf uses the same MCP configuration format as other tools
  // Configuration is stored in mcp_config.json in the project root
  const configPath = join(baseDir, "mcp_config.json");

  const mcpConfig = {
    mcpServers: Object.fromEntries(
      Object.entries(servers).map(([name, server]) => {
        const config: Record<string, unknown> = {};

        if (server.command) {
          config.command = server.command;
          if (server.args) {
            config.args = server.args;
          }
        } else if (server.url) {
          config.serverUrl = server.url;
        } else if (server.httpUrl) {
          config.serverUrl = server.httpUrl;
        }

        if (server.env) {
          config.env = server.env;
        }

        if (server.cwd) {
          config.cwd = server.cwd;
        }

        return [name, config];
      }),
    ),
  };

  return [
    {
      filepath: configPath,
      content: JSON.stringify(mcpConfig, null, 2),
    },
  ];
}
