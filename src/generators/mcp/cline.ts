import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type { BaseMcpServer } from "../../types/mcp-config.js";
import {
  configWrappers,
  generateMcpConfig,
  generateMcpConfigurationFiles,
  type McpServerMapping,
  serverTransforms,
} from "./shared-factory.js";

type ClineServer = BaseMcpServer & {
  // Allow additional properties that might be present in the server config
  [key: string]: unknown;
};

export function generateClineMcp(config: RulesyncMcpConfig): string {
  return generateMcpConfig(config, {
    target: "cline",
    configPaths: [".cline/mcp.json"],
    serverTransform: (server: RulesyncMcpServer): McpServerMapping => {
      const clineServer: ClineServer = {};

      if (server.command) {
        clineServer.command = server.command;
        if (server.args) clineServer.args = server.args;
      } else if (server.url) {
        clineServer.url = server.url;
      }

      if (server.env) {
        clineServer.env = server.env;
      }

      if (server.disabled !== undefined) {
        clineServer.disabled = server.disabled;
      }

      if (server.alwaysAllow) {
        clineServer.alwaysAllow = server.alwaysAllow;
      }

      if (server.networkTimeout !== undefined) {
        clineServer.networkTimeout = server.networkTimeout;
      }

      return clineServer;
    },
    configWrapper: configWrappers.mcpServers,
  });
}

export function generateClineMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFiles(
    mcpServers,
    {
      target: "cline",
      configPaths: [".cline/mcp.json"],
      serverTransform: serverTransforms.cleanRulesyncProps,
      configWrapper: configWrappers.mcpServers,
    },
    baseDir,
  );
}
