import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateQwenCodeMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("qwencode", config);
}

export function generateQwenCodeMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("qwencode", mcpServers, baseDir);
}
