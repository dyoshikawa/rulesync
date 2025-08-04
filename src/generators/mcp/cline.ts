import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateClineMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("cline", config);
}

export function generateClineMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("cline", mcpServers, baseDir);
}
