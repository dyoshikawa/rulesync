import type { Config, GeneratedOutput } from "../../types/index.js";
import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import { resolvePath } from "../../utils/file.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

export async function generateAmazonqcliMcp(
  mcpServers: Record<string, RulesyncMcpServer>,
  config: Config,
  baseDir?: string,
): Promise<GeneratedOutput[]> {
  const outputs: GeneratedOutput[] = [];

  // Amazon Q CLI supports two configuration levels
  const configPaths = [
    ".amazonq/mcp.json", // Workspace configuration
    // Note: Global configuration is ~/.aws/amazonq/mcp.json but is user-specific
    // According to precautions.md, we should not create user-level files
  ];

  for (const configPath of configPaths) {
    const filepath = resolvePath(configPath, baseDir);
    const content = generateAmazonqcliMcpConfig({ mcpServers });

    outputs.push({
      tool: "amazonqcli",
      filepath,
      content,
    });
  }

  return outputs;
}

export function generateAmazonqcliMcpString(config: RulesyncMcpConfig): string {
  return generateAmazonqcliMcpConfig(config);
}

function generateAmazonqcliMcpConfig(config: RulesyncMcpConfig): string {
  const servers: Record<string, unknown> = {};

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    // Check if this server should be included for Amazon Q CLI
    if (!shouldIncludeServer(server, "amazonqcli")) {
      continue;
    }

    const amazonqServer: Record<string, unknown> = {};

    // Amazon Q CLI uses standard MCP configuration format
    if (server.command) {
      amazonqServer.command = server.command;
      if (server.args) {
        amazonqServer.args = server.args;
      }
    }

    if (server.env) {
      amazonqServer.env = server.env;
    }

    // Amazon Q CLI specific fields
    if (server.timeout !== undefined) {
      amazonqServer.timeout = server.timeout;
    }

    if (server.disabled !== undefined) {
      amazonqServer.disabled = server.disabled;
    }

    if (server.alwaysAllow) {
      amazonqServer.autoApprove = server.alwaysAllow;
    }

    servers[serverName] = amazonqServer;
  }

  const finalConfig = {
    mcpServers: servers,
  };

  return `${JSON.stringify(finalConfig, null, 2)}\n`;
}
