import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateGeminiCliMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("geminicli", config);
}

export function generateGeminiCliMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("geminicli", mcpServers, baseDir);
}
