import type { McpServerBase } from "./mcp.js";

// Use the base MCP server type from mcp.ts and extend as needed
export interface BaseMcpServer extends Omit<McpServerBase, "kiroAutoApprove" | "kiroAutoBlock"> {
  // Additional fields specific to configuration generation
  autoApprove?: string[] | undefined;
  autoBlock?: string[] | undefined;
  autoapprove?: string[] | undefined;
  autoblock?: string[] | undefined;
}

export interface BaseMcpConfig {
  mcpServers: Record<string, BaseMcpServer>;
}

// Tool-specific config types that extend the base
export type ClineConfig = BaseMcpConfig;

export type CursorConfig = BaseMcpConfig;

export type RooConfig = BaseMcpConfig;

export interface KiroConfig {
  mcpServers: Record<
    string,
    Omit<BaseMcpServer, "transport"> & {
      transport?: "stdio" | "sse" | "http" | "streamable-http" | undefined;
      [key: string]: unknown;
    }
  >;
}

export interface ClaudeSettings {
  mcpServers?: Record<string, BaseMcpServer>;
}

export type GeminiSettings = BaseMcpConfig;

export interface CopilotCodingAgentConfig {
  mcpServers: Record<string, CopilotServer>;
}

// Copilot-specific types that need different structure
export interface CopilotServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  env?: Record<string, string> | undefined;
  tools?: string[] | undefined;
  type?: string | undefined;
}

export interface CopilotInput {
  id: string;
  type: "password" | "promptString";
  description: string;
  password?: boolean;
}

export interface CopilotEditorConfig {
  servers: Record<string, CopilotServer>;
  inputs?: CopilotInput[];
}
