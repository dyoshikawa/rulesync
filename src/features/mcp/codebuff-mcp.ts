import { join } from "node:path";

import { CODEBUFF_AGENTS_DIR, CODEBUFF_MCP_FILE_NAME } from "../../constants/codebuff-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  isRemoteMcpServer,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const TOOL_NAME = "codebuff";

// Keys rulesync maps onto Codebuff's server shape; every other canonical key is
// dropped (with a warning) because Codebuff's per-server schemas are strict.
const MAPPED_KEYS = new Set([
  "type",
  "transport",
  "command",
  "args",
  "env",
  "url",
  "httpUrl",
  "headers",
  "params",
  // `disabled: true` skips the server; `false` is the default and needs no key.
  "disabled",
]);

// A whole canonical `${VAR}` value, the only form with a Codebuff equivalent.
const WHOLE_CANONICAL_ENV_REF = /^\$\{(?!env:)([^}:]+)\}$/;
const CANONICAL_ENV_REF = /\$\{(?!env:)[^}:]+\}/;
// Codebuff's own `$VAR` form: any `env` value starting with `$` names a variable.
const WHOLE_CODEBUFF_ENV_REF = /^\$([A-Za-z_][A-Za-z0-9_]*)$/;

/**
 * Codebuff treats every `env` value starting with `$` as a variable reference
 * (the rest of the value is the variable name) and throws — dropping the whole
 * `mcp.json` — when that variable is unset. A whole-value canonical `${NAME}`
 * is rewritten to `$NAME`. Any other value starting with `$` has no Codebuff
 * form and would break the whole file, so `null` is returned and the caller
 * skips the server. A reference embedded later in a value is not resolved by
 * Codebuff; it is written as literal text with a warning.
 */
function toCodebuffEnv({
  name,
  env,
  logger,
}: {
  name: string;
  env: Record<string, string>;
  logger?: Logger;
}): Record<string, string> | null {
  const converted: Array<[string, string]> = [];
  for (const [key, value] of Object.entries(env)) {
    const match = WHOLE_CANONICAL_ENV_REF.exec(value);
    if (match) {
      converted.push([key, `$${match[1]}`]);
      continue;
    }
    if (value.startsWith("$")) {
      warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName: name,
        reason:
          `env ${quoteValueForWarning(key)} starting with "$" that is not a whole \${VAR} reference, ` +
          "which Codebuff would resolve as a variable name and fail to load the whole mcp.json",
        logger,
      });
      return null;
    }
    if (CANONICAL_ENV_REF.test(value)) {
      logger?.warn(
        `${TOOL_NAME} MCP: env ${quoteValueForWarning(key)} of server ${quoteValueForWarning(name)} embeds a \${VAR} reference; ` +
          "Codebuff only resolves a whole-value $VAR, so it is written as literal text.",
      );
    }
    converted.push([key, value]);
  }
  return Object.fromEntries(converted);
}

/**
 * Translate one canonical server into Codebuff's shape, or `null` to skip it.
 *
 * Codebuff validates each server with a strict schema — stdio
 * `{type, command, args, env}` or remote `{type: "http" | "sse", url, params,
 * headers}` — and skips the WHOLE file when any server fails, so only those keys
 * are written.
 *
 * @see https://github.com/CodebuffAI/freebuff/blob/main/common/src/types/mcp.ts
 */
function toCodebuffServer({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  if (server.disabled === true) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "disabled: true, which Codebuff has no per-server switch for",
      logger,
    });
  }

  const transport = server.type ?? server.transport;
  if (transport === "ws") {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "the WebSocket transport, which Codebuff does not support",
      logger,
    });
  }

  const dropped = Object.keys(server).filter((key) => !MAPPED_KEYS.has(key));
  if (dropped.length > 0) {
    logger?.warn(
      `${TOOL_NAME} MCP: dropping ${dropped.map((key) => quoteValueForWarning(key)).join(", ")} from server ${quoteValueForWarning(name)}; ` +
        "Codebuff rejects keys outside its server schema.",
    );
  }

  if (isRemoteMcpServer(server)) {
    const url = resolveRemoteMcpUrl(server);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName: name,
        reason: "a remote transport without a url",
        logger,
      });
    }
    const params: unknown = server.params;
    const validParams =
      isRecord(params) && Object.values(params).every((value) => typeof value === "string");
    if (params !== undefined && !validParams) {
      logger?.warn(
        `${TOOL_NAME} MCP: dropping params from server ${quoteValueForWarning(name)}; ` +
          "Codebuff accepts only a map of string values.",
      );
    }
    return {
      type: transport === "sse" ? "sse" : "http",
      url,
      ...(validParams && { params }),
      ...(server.headers && { headers: server.headers }),
    };
  }

  const [command, ...args] = resolveLocalMcpCommand(server);
  if (command === undefined) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName: name,
      reason: "no command to spawn",
      logger,
    });
  }
  const env = server.env ? toCodebuffEnv({ name, env: server.env, logger }) : undefined;
  if (env === null) {
    return null;
  }
  return {
    type: "stdio",
    command,
    ...(args.length > 0 && { args }),
    ...(env && { env }),
  };
}

/** Lift Codebuff's `$VAR` env references back into the canonical `${VAR}`. */
function toRulesyncServer(server: unknown): unknown {
  if (!isRecord(server) || !isRecord(server.env)) {
    return server;
  }
  const env = Object.fromEntries(
    Object.entries(server.env).map(([key, value]) => [
      key,
      typeof value === "string" ? value.replace(WHOLE_CODEBUFF_ENV_REF, "$${$1}") : value,
    ]),
  );
  return { ...server, env };
}

/**
 * Codebuff (Freebuff) MCP servers.
 *
 * Codebuff reads the `mcpServers` map of `mcp.json` inside `.agents/` — at the
 * project root (`.agents/mcp.json`) and in the home directory
 * (`~/.agents/mcp.json`) — and hands the servers to its base agents.
 *
 * @see https://www.codebuff.com/docs/tips/mcp-servers
 * @see https://github.com/CodebuffAI/freebuff/blob/main/sdk/src/agents/load-mcp-config.ts
 */
export class CodebuffMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // `~/.agents/` is shared with other tools and may hold servers the user
    // manages by hand, so the global file is never deleted.
    return !this.global;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The same relative path in both scopes; global mode resolves it under the
    // user home (`~/.agents/mcp.json`).
    return {
      relativeDirPath: CODEBUFF_AGENTS_DIR,
      relativeFilePath: CODEBUFF_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodebuffMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new CodebuffMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): CodebuffMcp {
    const paths = this.getSettablePaths({ global });

    const entries: Array<[string, Record<string, unknown>]> = [];
    for (const [name, server] of Object.entries(rulesyncMcp.getMcpServers())) {
      const converted = toCodebuffServer({ name, server, logger });
      if (converted !== null) {
        entries.push([name, converted]);
      }
    }
    const mcpServers = Object.fromEntries(entries);

    return new CodebuffMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ mcpServers }, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json.mcpServers) ? this.json.mcpServers : {};
    const mcpServers = Object.fromEntries(
      Object.entries(servers).map(([name, server]) => [name, toRulesyncServer(server)]),
    );
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
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
  }: ToolMcpForDeletionParams): CodebuffMcp {
    return new CodebuffMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
