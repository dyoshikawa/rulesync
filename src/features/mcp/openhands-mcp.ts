import { join } from "node:path";

import { OPENHANDS_DIR, OPENHANDS_MCP_FILE_NAME } from "../../constants/openhands-paths.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { findServersWithEnvVarRefs } from "./mcp-env-var-format.js";
import { parseMcpJsonObjectOrThrow } from "./mcp-json-config.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  resolveHttpOrSseRemoteType,
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

const TOOL_NAME = "OpenHands";

const OPENHANDS_GLOBAL_ONLY_MESSAGE =
  "OpenHands MCP is global-only; use --global to sync ~/.openhands/mcp.json";

/** Server keys rulesync writes itself, so an existing value never survives. */
const OPENHANDS_MANAGED_SERVER_KEYS: ReadonlySet<string> = new Set([
  "command",
  "args",
  "env",
  "url",
  "transport",
  "headers",
  "auth",
  "enabled",
]);

function copyStringMap(value: unknown): Record<string, string> | undefined {
  if (!isRecord(value)) return undefined;
  const entries = Object.entries(value).filter(
    (entry): entry is [string, string] =>
      !PROTOTYPE_POLLUTION_KEYS.has(entry[0]) && typeof entry[1] === "string",
  );
  return entries.length > 0 ? Object.fromEntries(entries) : undefined;
}

/**
 * Copy the keys of an existing same-named server that rulesync does not
 * manage (a field a newer OpenHands or FastMCP reads, such as `timeout` or
 * `tools`) onto the generated server.
 */
function carryOverUnmanagedKeys({
  converted,
  existing,
}: {
  converted: Record<string, unknown>;
  existing: unknown;
}): void {
  if (!isRecord(existing)) return;
  for (const [key, value] of Object.entries(existing)) {
    if (
      PROTOTYPE_POLLUTION_KEYS.has(key) ||
      OPENHANDS_MANAGED_SERVER_KEYS.has(key) ||
      Object.hasOwn(converted, key)
    ) {
      continue;
    }
    converted[key] = value;
  }
}

function toOpenhandsRemoteServer({
  config,
  skip,
}: {
  config: McpServers[string];
  skip: (reason: string) => void;
}): Record<string, unknown> | undefined {
  const url = resolveRemoteMcpUrl(config);
  if (!url) {
    skip("a remote transport without a url");
    return undefined;
  }
  const stated = config.type ?? config.transport;
  const transport = resolveHttpOrSseRemoteType({ stated, url });
  if (transport === undefined) {
    skip(
      stated === undefined
        ? "a WebSocket url, which OpenHands' remote transports (http, sse) cannot reach"
        : `the "${stated}" transport, which OpenHands does not support (only stdio, http and sse)`,
    );
    return undefined;
  }
  const converted: Record<string, unknown> = { url, transport };
  const headers = copyStringMap(config.headers);
  if (headers) converted.headers = headers;
  if (config.auth === "oauth") converted.auth = "oauth";
  return converted;
}

function toOpenhandsStdioServer({
  name,
  config,
  skip,
  logger,
}: {
  name: string;
  config: McpServers[string];
  skip: (reason: string) => void;
  logger?: Logger;
}): Record<string, unknown> | undefined {
  const [command, ...args] = resolveLocalMcpCommand(config);
  if (!command) {
    skip("a stdio transport without a command");
    return undefined;
  }
  const converted: Record<string, unknown> = { command };
  if (args.length > 0) converted.args = args;
  const env = copyStringMap(config.env);
  if (env) converted.env = env;
  if (typeof config.cwd === "string" && config.cwd !== "") {
    logger?.warn(
      `${TOOL_NAME} MCP server ${quoteValueForWarning(name)}: dropping cwd, which the documented OpenHands server config has no key for.`,
    );
  }
  return converted;
}

/**
 * Convert canonical rulesync servers to OpenHands' `mcpServers` entries:
 * stdio servers carry `command`, `args` and `env` (the documented manual
 * format); remote servers carry `url`, `transport` (`http` or `sse`, what
 * `openhands mcp add --transport` accepts), `headers` (`--header`) and
 * `auth: "oauth"` (`--auth oauth`). A canonical `disabled: true` is written as
 * `enabled: false`, the flag `openhands mcp disable` sets. Keys rulesync does
 * not manage on a same-named server of the existing file are carried over.
 *
 * @see https://docs.openhands.dev/openhands/usage/cli/mcp-servers
 */
export function convertToOpenhandsFormat({
  mcpServers,
  logger,
  existingServers = {},
}: {
  mcpServers: McpServers;
  logger?: Logger;
  existingServers?: Record<string, unknown>;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const skip = (reason: string): void => {
      warnAndSkipMcpServer({ toolName: TOOL_NAME, serverName: name, reason, logger });
    };
    if (declaresNoTransport(config)) {
      skip("no transport");
      continue;
    }
    const converted = isRemoteMcpServer(config)
      ? toOpenhandsRemoteServer({ config, skip })
      : toOpenhandsStdioServer({ name, config, skip, logger });
    if (converted === undefined) continue;
    if (config.disabled === true) converted.enabled = false;
    carryOverUnmanagedKeys({
      converted,
      existing: lookupOwn({ record: existingServers, key: name }),
    });
    result[name] = converted;
  }
  return result;
}

/**
 * Convert OpenHands' `mcpServers` entries back to canonical rulesync servers.
 */
export function convertFromOpenhandsFormat(servers: Record<string, unknown>): McpServers {
  const result: McpServers = {};
  for (const [name, config] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const server: Record<string, unknown> = {};
    const transport =
      typeof config.transport === "string" ? config.transport.trim().toLowerCase() : undefined;
    if (typeof config.url === "string" && transport !== "stdio") {
      server.type = transport === "sse" ? "sse" : "http";
      server.url = config.url;
      const headers = copyStringMap(config.headers);
      if (headers) server.headers = headers;
      if (config.auth === "oauth") server.auth = "oauth";
    } else if (typeof config.command === "string" && config.command !== "") {
      server.type = "stdio";
      server.command = config.command;
      if (isStringArray(config.args) && config.args.length > 0) server.args = config.args;
      const env = copyStringMap(config.env);
      if (env) server.env = env;
    } else {
      continue;
    }
    if (config.enabled === false) server.disabled = true;
    result[name] = server;
  }
  return result;
}

function parseOpenhandsMcpConfig(fileContent: string, relativePath: string) {
  return parseMcpJsonObjectOrThrow({
    fileContent,
    relativePath,
    label: TOOL_NAME,
    parse: JSON.parse,
  });
}

/**
 * OpenHands MCP servers.
 *
 * OpenHands reads MCP servers from the `mcpServers` object of the user-level
 * `~/.openhands/mcp.json` only; there is no project-scoped MCP file. The
 * `openhands mcp` commands edit the same file, so rulesync replaces
 * `mcpServers` only, keeps every other top-level key and the unmanaged keys
 * of existing servers, refuses to rewrite a file it cannot parse and never
 * deletes the file.
 *
 * OpenHands does not document expanding environment variable references, so they are
 * written literally, with a warning.
 *
 * @see https://docs.openhands.dev/openhands/usage/cli/mcp-servers
 */
export class OpenhandsMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? parseOpenhandsMcpConfig(
            this.fileContent,
            join(this.relativeDirPath, this.relativeFilePath),
          )
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // `openhands mcp` manages the same file (and may keep other keys there),
    // so it is never removed wholesale.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: OPENHANDS_DIR,
      relativeFilePath: OPENHANDS_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<OpenhandsMcp> {
    if (!global) {
      throw new Error(OPENHANDS_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    return new OpenhandsMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<OpenhandsMcp> {
    if (!global) {
      throw new Error(OPENHANDS_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const existingContent = await readFileContentOrNull(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );
    const existing =
      existingContent === null
        ? {}
        : parseOpenhandsMcpConfig(
            existingContent,
            join(paths.relativeDirPath, paths.relativeFilePath),
          );

    const mcpServers = rulesyncMcp.getMcpServers();
    const withEnvRefs = findServersWithEnvVarRefs(mcpServers);
    if (withEnvRefs.length > 0) {
      logger?.warn(
        `${TOOL_NAME} MCP servers ${withEnvRefs.map((name) => quoteValueForWarning(name)).join(", ")} ` +
          "use environment variable references (${VAR}), which OpenHands does not document expanding; " +
          "they are written literally. Use a wrapper script or a secret manager instead.",
      );
    }
    const converted = convertToOpenhandsFormat({
      mcpServers,
      logger,
      existingServers: isRecord(existing.mcpServers) ? existing.mcpServers : {},
    });

    return new OpenhandsMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ ...existing, mcpServers: converted }, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = isRecord(this.json.mcpServers) ? this.json.mcpServers : {};
    // Never spread the file itself: only `mcpServers` belongs in the rulesync source.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertFromOpenhandsFormat(servers) }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): OpenhandsMcp {
    return new OpenhandsMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
