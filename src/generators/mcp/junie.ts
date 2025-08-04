import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateJunieMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("junie", config);
}

export function generateJunieMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("junie", mcpServers, baseDir);
}
