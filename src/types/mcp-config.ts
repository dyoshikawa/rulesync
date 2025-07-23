export interface BaseMcpServer {
  command?: string | undefined;
  args?: string[] | undefined;
  url?: string | undefined;
  httpUrl?: string | undefined;
  env?: Record<string, string> | undefined;
  disabled?: boolean | undefined;
  alwaysAllow?: string[] | undefined;
  networkTimeout?: number | undefined;
  timeout?: number | undefined;
  type?: "stdio" | "sse" | "streamable-http" | "http" | undefined;
  tools?: string[] | undefined;
  headers?: Record<string, string> | undefined;
  cwd?: string | undefined;
  autoApprove?: string[] | undefined;
  autoBlock?: string[] | undefined;
  autoapprove?: string[] | undefined;
  autoblock?: string[] | undefined;
  trust?: boolean | undefined;
}

export interface BaseMcpConfig {
  mcpServers: Record<string, BaseMcpServer>;
}

// Tool-specific config types that extend the base
export type ClineConfig = BaseMcpConfig;

export type CursorConfig = BaseMcpConfig;

export type RooConfig = BaseMcpConfig;

export type KiroConfig = BaseMcpConfig;

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
