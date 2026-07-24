import { join } from "node:path";

import { KIMI_CODE_DIR, KIMI_CODE_MCP_FILE_NAME } from "../../constants/kimi-code-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  type ToolMcpForDeletionParams,
  type ToolMcpFromFileParams,
  type ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  type ToolMcpSettablePaths,
} from "./tool-mcp.js";

function normalizeKimiCodeTransport({
  transport,
  hasCommand,
}: {
  transport: unknown;
  hasCommand: boolean;
}): "stdio" | "http" | "sse" {
  if (transport === "local" || transport === "stdio") {
    return "stdio";
  }
  if (transport === "sse") {
    return "sse";
  }
  if (transport === "http" || transport === "streamable-http") {
    return "http";
  }
  return hasCommand ? "stdio" : "http";
}

function toKimiCodeServer({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  const transport = server.transport ?? server.type;
  if (transport === "ws") {
    logger?.warn(`Kimi Code MCP: skipping "${name}" because WebSocket transport is unsupported.`);
    return null;
  }

  const command = server.command;
  const normalizedCommand = Array.isArray(command) ? command[0] : command;
  const commandArgs = Array.isArray(command) ? command.slice(1) : [];
  const args = [...commandArgs, ...(server.args ?? [])];
  const url = server.httpUrl ?? server.url;
  const normalizedTransport = normalizeKimiCodeTransport({
    transport,
    hasCommand: normalizedCommand !== undefined,
  });
  if (
    (normalizedTransport === "stdio" && !normalizedCommand) ||
    (normalizedTransport !== "stdio" && !url)
  ) {
    logger?.warn(
      `Kimi Code MCP: skipping "${name}" because its ${normalizedTransport} configuration is incomplete.`,
    );
    return null;
  }

  const converted: Record<string, unknown> = {
    transport: normalizedTransport,
    ...(normalizedCommand && { command: normalizedCommand }),
    ...(args.length > 0 && { args }),
    ...(url && { url }),
  };
  for (const field of [
    "env",
    "cwd",
    "headers",
    "bearerTokenEnvVar",
    "enabled",
    "startupTimeoutMs",
    "toolTimeoutMs",
    "enabledTools",
    "disabledTools",
  ]) {
    if (server[field] !== undefined) {
      converted[field] = server[field];
    }
  }
  if (server.disabled === true) {
    converted.enabled = false;
  }
  return converted;
}

function toKimiCodeServers({
  servers,
  logger,
}: {
  servers: McpServers;
  logger?: Logger;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    const converted = toKimiCodeServer({ name, server, logger });
    if (converted) {
      result[name] = converted;
    }
  }
  return result;
}

function fromKimiCodeServers(servers: McpServers): McpServers {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const { transport, enabled, ...rest } = server;
      const type =
        transport === "stdio" || transport === "sse" || transport === "http"
          ? transport
          : undefined;
      return [
        name,
        {
          ...rest,
          ...(type && { type }),
          ...(enabled === false && { disabled: true }),
        },
      ];
    }),
  );
}

/**
 * Kimi Code MCP configuration.
 *
 * Both project and user scope use `.kimi-code/mcp.json`, resolved against the
 * project root or home directory respectively.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/mcp.html
 */
export class KimiCodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    try {
      this.json = this.fileContent ? JSON.parse(this.fileContent) : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Kimi Code MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: KIMI_CODE_DIR,
      relativeFilePath: KIMI_CODE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KimiCodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<KimiCodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Kimi Code MCP config at ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }

    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(
        {
          ...existing,
          mcpServers: toKimiCodeServers({
            servers: rulesyncMcp.getMcpServers(),
            logger,
          }),
        },
        null,
        2,
      ),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          ...this.json,
          mcpServers: fromKimiCodeServers(
            isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {},
          ),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): KimiCodeMcp {
    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
