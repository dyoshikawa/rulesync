import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateOpenCodeMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("opencode", config);
}

export function generateOpenCodeMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("opencode", mcpServers, baseDir);
}
