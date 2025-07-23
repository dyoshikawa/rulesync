import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import type {
  CopilotCodingAgentConfig,
  CopilotEditorConfig,
  CopilotInput,
  CopilotServer,
} from "../../types/mcp-config.js";
import { shouldIncludeServer } from "../../utils/mcp-helpers.js";

export function generateCopilotMcp(
  config: RulesyncMcpConfig,
  target: "codingAgent" | "editor",
): string {
  const servers: Record<string, CopilotServer> = {};
  const inputs: CopilotInput[] = [];
  const inputMap = new Map<string, string>();

  for (const [serverName, server] of Object.entries(config.mcpServers)) {
    if (!shouldIncludeServer(server, "copilot")) continue;

    const copilotServer: CopilotServer = {};

    if (server.command) {
      copilotServer.command = server.command;
      if (server.args) copilotServer.args = server.args;
    } else if (server.url || server.httpUrl) {
      const url = server.httpUrl || server.url;
      if (url) {
        copilotServer.url = url;
      }
    }

    if (server.env) {
      copilotServer.env = {};
      for (const [key, value] of Object.entries(server.env)) {
        if (target === "editor" && value.includes("SECRET")) {
          const inputId = `${serverName}_${key}`;
          inputMap.set(inputId, value);
          copilotServer.env[key] = `\${input:${inputId}}`;
          inputs.push({
            id: inputId,
            type: "password",
            description: `${key} for ${serverName}`,
          });
        } else {
          copilotServer.env[key] = value;
        }
      }
    }

    if (server.tools) {
      copilotServer.tools = server.tools;
    } else if (server.alwaysAllow) {
      copilotServer.tools = server.alwaysAllow;
    }

    servers[serverName] = copilotServer;
  }

  if (target === "codingAgent") {
    const config: CopilotCodingAgentConfig = { mcpServers: servers };
    return JSON.stringify(config, null, 2);
  } else {
    const config: CopilotEditorConfig = { servers };
    if (inputs.length > 0) {
      config.inputs = inputs;
    }
    return JSON.stringify(config, null, 2);
  }
}

export function generateCopilotMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  const configs: Array<{ filepath: string; content: string }> = [];

  const rulesyncConfig: RulesyncMcpConfig = { mcpServers };

  // Generate .vscode/mcp.json (editor config)
  const editorContent = generateCopilotMcp(rulesyncConfig, "editor");
  configs.push({
    filepath: baseDir ? `${baseDir}/.vscode/mcp.json` : ".vscode/mcp.json",
    content: `${editorContent}\n`,
  });

  // Generate .copilot/mcp.json (coding agent config)
  const codingAgentContent = generateCopilotMcp(rulesyncConfig, "codingAgent");
  configs.push({
    filepath: baseDir ? `${baseDir}/.copilot/mcp.json` : ".copilot/mcp.json",
    content: `${codingAgentContent}\n`,
  });

  return configs;
}
