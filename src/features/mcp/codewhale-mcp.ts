import { join } from "node:path";

import { CODEWHALE_DIR, CODEWHALE_MCP_FILE_NAME } from "../../constants/codewhale-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeysDeep,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import {
  declaresNoTransport,
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

type CodewhaleMcpServers = Record<string, Record<string, unknown>>;

/**
 * Codewhale reads the server map from `servers`, with `mcpServers` accepted as
 * a serde alias. Both keys in one file is a duplicate-field error, so rulesync
 * writes back to whichever key the file already uses (`servers` by default)
 * and never both.
 */
const SERVERS_KEY = "servers";
const SERVERS_ALIAS_KEY = "mcpServers";

/**
 * Canonical keys that are consumed by the conversion below (or have no
 * Codewhale counterpart) and therefore must not be copied verbatim.
 */
const CONSUMED_CANONICAL_KEYS = new Set([
  "type",
  "transport",
  "url",
  "httpUrl",
  "command",
  "args",
  "timeout",
  "enabledTools",
  "disabledTools",
]);

/**
 * Parse a Codewhale MCP file, failing closed on malformed JSON or a non-object
 * root (`null`, an array, a scalar) rather than spreading whatever came back
 * into the regenerated file.
 */
function parseCodewhaleMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse Codewhale MCP config at ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Codewhale MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * Convert the canonical server map to Codewhale's `mcp.json` shape. A stdio
 * server carries `command` plus `args`; a remote server carries `url`, which
 * Codewhale connects to over Streamable HTTP (falling back to legacy SSE), and
 * `transport: "sse"` is written only for a server declared as SSE. The
 * camelCase tool filters become `enabled_tools` / `disabled_tools`; `env`,
 * `headers`, `cwd`, `disabled` and any other key pass through.
 *
 * A server Codewhale cannot start or reach — no transport, a remote transport
 * without a URL, a WebSocket server, or a stdio entry without a command — is
 * skipped with a warning.
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/MCP.md
 */
function convertToCodewhaleFormat(mcpServers: McpServers, logger?: Logger): CodewhaleMcpServers {
  const result: CodewhaleMcpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;

    if (declaresNoTransport(serverConfig)) {
      warnAndSkipMcpServer({ toolName: "Codewhale", serverName, reason: "no transport", logger });
      continue;
    }

    const converted: Record<string, unknown> = {};

    if (isRemoteMcpServer(serverConfig)) {
      const url = resolveRemoteMcpUrl(serverConfig);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "Codewhale",
          serverName,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      const stated = serverConfig.type ?? serverConfig.transport;
      if (stated === "ws" || /^wss?:\/\//i.test(url)) {
        warnAndSkipMcpServer({
          toolName: "Codewhale",
          serverName,
          reason: "a WebSocket transport, which Codewhale does not support",
          logger,
        });
        continue;
      }
      converted.url = url;
      if (stated === "sse") {
        converted.transport = "sse";
      }
    } else {
      const [command, ...args] = resolveLocalMcpCommand(serverConfig);
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Codewhale",
          serverName,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.command = command;
      if (args.length > 0) {
        converted.args = args;
      }
    }

    if (Array.isArray(serverConfig.enabledTools)) {
      converted.enabled_tools = serverConfig.enabledTools;
    }
    if (Array.isArray(serverConfig.disabledTools)) {
      converted.disabled_tools = serverConfig.disabledTools;
    }

    for (const [key, value] of Object.entries(serverConfig)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key) || CONSUMED_CANONICAL_KEYS.has(key)) continue;
      converted[key] = omitPrototypePollutionKeysDeep(value);
    }
    result[serverName] = converted;
  }

  return result;
}

/**
 * Convert Codewhale's server map back to the canonical shape: `transport:
 * "sse"` becomes `type: "sse"`, and the snake_case tool filters become
 * `enabledTools` / `disabledTools`. Everything else passes through with
 * prototype-pollution keys dropped at every nesting level.
 */
function convertFromCodewhaleFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};

  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    const {
      transport,
      enabled_tools: enabledTools,
      disabled_tools: disabledTools,
      ...rest
    } = omitPrototypePollutionKeysDeep(serverConfig) as Record<string, unknown>;
    const converted: Record<string, unknown> = { ...rest };
    if (typeof transport === "string" && transport.trim().toLowerCase() === "sse") {
      converted.type = "sse";
    }
    if (Array.isArray(enabledTools)) {
      converted.enabledTools = enabledTools;
    }
    if (Array.isArray(disabledTools)) {
      converted.disabledTools = disabledTools;
    }
    result[serverName] = converted;
  }

  return result;
}

function readServerMap(json: Record<string, unknown>): unknown {
  return json[SERVERS_KEY] ?? json[SERVERS_ALIAS_KEY];
}

/**
 * Codewhale MCP configuration (`.codewhale/mcp.json` in the workspace, and
 * `~/.codewhale/mcp.json` for the user).
 *
 * Codewhale honors the workspace file only once the workspace is trusted, and
 * a project server overrides a same-named user server. Top-level keys other
 * than the server map (for example `timeouts`) are preserved. The files are
 * also edited by Codewhale's own `/mcp` commands, so `--delete` leaves them in
 * place rather than removing a file the user did not create through rulesync.
 *
 * @see https://github.com/Hmbown/Codewhale/blob/main/docs/MCP.md
 * @see https://github.com/Hmbown/Codewhale/blob/main/crates/tui/src/mcp.rs
 */
export class CodewhaleMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseCodewhaleMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The same relative path serves both scopes; the processor supplies the
    // home directory as outputRoot in global mode.
    return {
      relativeDirPath: CODEWHALE_DIR,
      relativeFilePath: CODEWHALE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodewhaleMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"servers":{}}';

    return new CodewhaleMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CodewhaleMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    const existingContent = await readFileContentOrNull(filePath);
    const json =
      existingContent === null
        ? {}
        : parseCodewhaleMcpConfig({
            fileContent: existingContent,
            relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
          });

    // Keep the key the file already uses; `servers` wins when the file has
    // neither (or, though Codewhale itself rejects that, both).
    const serversKey =
      json[SERVERS_ALIAS_KEY] !== undefined && json[SERVERS_KEY] === undefined
        ? SERVERS_ALIAS_KEY
        : SERVERS_KEY;
    const { [SERVERS_KEY]: _servers, [SERVERS_ALIAS_KEY]: _alias, ...siblings } = json;
    const mcpServers = convertToCodewhaleFormat(rulesyncMcp.getMcpServers(), logger);
    const codewhaleConfig = { ...siblings, [serversKey]: mcpServers };

    return new CodewhaleMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(codewhaleConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCodewhaleFormat(readServerMap(this.json));
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
  }: ToolMcpForDeletionParams): CodewhaleMcp {
    return new CodewhaleMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
