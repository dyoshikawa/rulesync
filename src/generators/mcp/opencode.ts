import { join } from "node:path";
import type { RulesyncMcpServer } from "../../types/index.js";

export async function generateOpencodeJsonMcpConfiguration(
  servers: Record<string, RulesyncMcpServer>,
  dir: string,
): Promise<Array<{ filepath: string; content: string }>> {
  const opencodeServers: Record<string, unknown> = {};

  for (const [name, server] of Object.entries(servers)) {
    if (!server.targets?.includes("opencode" as any)) continue;

    if (server.command) {
      // Local STDIO server
      opencodeServers[name] = {
        type: "local",
        command: [server.command, ...(server.args || [])],
        enabled: true,
        ...(server.env && { environment: server.env }),
        ...(server.cwd && { cwd: server.cwd }),
      };
    } else if (server.url || server.httpUrl) {
      // Remote server
      opencodeServers[name] = {
        type: "remote",
        url: server.url || server.httpUrl,
        enabled: true,
        ...(server.headers && { headers: server.headers }),
      };
    }
  }

  if (Object.keys(opencodeServers).length === 0) {
    return [];
  }

  const config = {
    $schema: "https://opencode.ai/config.json",
    mcp: opencodeServers,
  };

  return [
    {
      filepath: join(dir, "opencode.json"),
      content: JSON.stringify(config, null, 2),
    },
  ];
}