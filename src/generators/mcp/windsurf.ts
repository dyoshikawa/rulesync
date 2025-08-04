import type { RulesyncMcpConfig, RulesyncMcpServer } from "../../types/mcp.js";
import {
  generateMcpConfigurationFilesFromRegistry,
  generateMcpFromRegistry,
} from "./shared-factory.js";

export function generateWindsurfMcp(config: RulesyncMcpConfig): string {
  return generateMcpFromRegistry("windsurf", config);
}

export function generateWindsurfMcpConfiguration(
  mcpServers: Record<string, RulesyncMcpServer>,
  baseDir: string = "",
): Array<{ filepath: string; content: string }> {
  return generateMcpConfigurationFilesFromRegistry("windsurf", mcpServers, baseDir);
}
