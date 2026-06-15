import { join } from "node:path";

import * as smolToml from "smol-toml";

import { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type VibeConfig = Record<string, unknown> & {
  mcp_servers?: VibeMcpServer[];
};

type VibeMcpServer = Record<string, unknown> & {
  name: string;
  transport?: string;
};

const VIBE_MCP_SERVER_FIELDS = [
  "transport",
  "url",
  "headers",
  "api_key_env",
  "api_key_header",
  "api_key_format",
  "command",
  "args",
  "env",
  "startup_timeout_sec",
  "tool_timeout_sec",
] as const;

export class VibeMcp extends ToolMcp {
  private readonly toml: VibeConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.toml = parseVibeConfig(this.fileContent);
  }

  getToml(): VibeConfig {
    return this.toml;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<VibeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const config = parseVibeConfig(fileContent);
    config.mcp_servers = normalizeMcpServersArray(config.mcp_servers);

    return new VibeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(config),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<VibeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const config = parseVibeConfig(existingContent);

    config.mcp_servers = Object.entries(rulesyncMcp.getMcpServers()).map(([name, server]) =>
      rulesyncMcpServerToVibe(name, server),
    );

    return new VibeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(config),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers: McpServers = Object.fromEntries(
      normalizeMcpServersArray(this.toml.mcp_servers).map((server) => [
        server.name,
        vibeMcpServerToRulesync(server),
      ]),
    );

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseVibeConfig(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Vibe config TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): VibeMcp {
    return new VibeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}

function parseVibeConfig(fileContent: string): VibeConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

function normalizeMcpServersArray(value: unknown): VibeMcpServer[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => {
      return entry !== null && typeof entry === "object" && !Array.isArray(entry);
    })
    .filter((entry): entry is VibeMcpServer => typeof entry.name === "string");
}

function rulesyncMcpServerToVibe(name: string, server: McpServer): VibeMcpServer {
  const serverRecord = server as Record<string, unknown>;
  const transport = resolveVibeTransport(server);
  const vibeServer: VibeMcpServer = {
    name,
    ...(transport !== undefined && { transport }),
  };

  if (server.command !== undefined) {
    if (Array.isArray(server.command)) {
      const [command, ...commandArgs] = server.command;
      if (command !== undefined) {
        vibeServer.command = command;
      }
      const args = [...commandArgs, ...(server.args ?? [])];
      if (args.length > 0) {
        vibeServer.args = args;
      }
    } else {
      vibeServer.command = server.command;
      if (server.args !== undefined) {
        vibeServer.args = server.args;
      }
    }
  }

  for (const field of VIBE_MCP_SERVER_FIELDS) {
    if (field === "transport" || field === "command" || field === "args") {
      continue;
    }
    if (serverRecord[field] !== undefined) {
      vibeServer[field] = serverRecord[field];
    }
  }
  if (vibeServer.url === undefined && server.httpUrl !== undefined) {
    vibeServer.url = server.httpUrl;
  }

  return vibeServer;
}

function vibeMcpServerToRulesync(server: VibeMcpServer): McpServer {
  const result: Record<string, unknown> = {};
  const transport = typeof server.transport === "string" ? server.transport : undefined;
  if (transport !== undefined) {
    result.transport = transport;
    result.type = transport === "streamable-http" ? "streamable-http" : transport;
  }

  for (const field of VIBE_MCP_SERVER_FIELDS) {
    if (field === "transport") {
      continue;
    }
    if (server[field] !== undefined) {
      result[field] = server[field];
    }
  }

  return result as McpServer;
}

function resolveVibeTransport(server: McpServer): string | undefined {
  if (server.transport) {
    if (server.transport === "sse") {
      return "http";
    }
    if (server.transport === "local") {
      return "stdio";
    }
    return server.transport;
  }
  if (server.type) {
    if (server.type === "sse") {
      return "http";
    }
    if (server.type === "local") {
      return "stdio";
    }
    return server.type;
  }
  if (server.command) {
    return "stdio";
  }
  if (server.url || server.httpUrl) {
    return "http";
  }
  return undefined;
}
