import { join } from "node:path";

import { dump, load } from "js-yaml";

import {
  TAKT_CONFIG_FILE_NAME,
  TAKT_DIR,
  TAKT_WORKFLOW_MCP_SERVERS_KEY,
} from "../../constants/takt-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  type ToolMcpForDeletionParams,
  type ToolMcpFromFileParams,
  type ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  type ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * The three MCP transports Takt's allowlist can gate. Takt models exactly these
 * (`stdio` / `sse` / `http`); every other rulesync transport alias is folded
 * onto one of them by {@link transportOf}.
 */
type TaktTransport = "stdio" | "sse" | "http";

/**
 * MCP adapter for Takt (`.takt/config.yaml` project / `~/.takt/config.yaml`
 * global).
 *
 * IMPORTANT — what this adapter can and cannot represent.
 *
 * Takt does NOT have a project- or global-level registry of MCP *server
 * definitions*. The concrete `mcp_servers` map (a server's `command`/`args`/`env`
 * or `type`/`url`/`headers`) is declared per-step inside individual *workflow*
 * YAML files; there is no top-level `mcp_servers` key in `config.yaml`, and the
 * config loader hard-rejects unknown top-level keys
 * (`assertNoUnknownGlobalConfigKeys`). Writing a server map into `config.yaml`
 * would therefore both be ignored and break the user's config.
 *
 * What `config.yaml` *does* hold is the default-deny transport allowlist
 * `workflow_mcp_servers: { stdio, sse, http }`. Without it, workflow-defined MCP
 * servers are refused regardless of how they are declared. So this adapter emits
 * the transport allowlist derived from the transports present in
 * `.rulesync/mcp.json`, enabling exactly the transports the user's servers need.
 *
 * Lossiness (documented, intentional): the per-server names, commands, env, URLs
 * and headers are NOT representable in `config.yaml` and are intentionally not
 * written. Users still declare the concrete servers in their workflow YAML
 * steps; rulesync only opens the transport gate that permits them. As a
 * corollary, import (`toRulesyncMcp`) cannot reconstruct server definitions from
 * a transport allowlist and yields an empty `mcpServers` map.
 *
 * The shared `config.yaml` is merged in place: only the
 * `workflow_mcp_servers` key is set; every other top-level key (provider,
 * provider_profiles, etc.) is preserved. The file is never deleted.
 *
 * @see https://github.com/nrslib/takt/blob/main/docs/configuration.md
 * @see https://github.com/nrslib/takt/blob/main/src/core/models/mcp-schemas.ts
 */
export class TaktMcp extends ToolMcp {
  constructor(params: ToolMcpParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
  }

  override isDeletable(): boolean {
    // config.yaml holds other Takt settings (provider, profiles, ...), so it
    // must never be removed wholesale; changes happen via in-place merge.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    // Project: `.takt/config.yaml`; global: `~/.takt/config.yaml` (the home
    // directory is resolved by the processor through outputRoot). Same as the
    // permissions adapter so the two features co-locate in one config file.
    return {
      relativeDirPath: TAKT_DIR,
      relativeFilePath: TAKT_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<TaktMcp> {
    const paths = TaktMcp.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new TaktMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<TaktMcp> {
    const paths = TaktMcp.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so a dry-run/check does not create the user's
    // config.yaml as a side effect (mirrors the permissions adapter).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const config = parseTaktConfig(existingContent, paths.relativeDirPath, paths.relativeFilePath);

    const allowlist = deriveTransportAllowlist(rulesyncMcp.getMcpServers());

    const merged: Record<string, unknown> = {
      ...config,
      [TAKT_WORKFLOW_MCP_SERVERS_KEY]: allowlist,
    };

    return new TaktMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: dump(merged),
      validate,
      global,
    });
  }

  /**
   * A transport allowlist cannot reconstruct the per-step server definitions,
   * so import yields an empty `mcpServers` map. This keeps the round-trip honest
   * rather than fabricating placeholder servers.
   */
  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
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
  }: ToolMcpForDeletionParams): TaktMcp {
    return new TaktMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}

/**
 * Parse a Takt `config.yaml` into a plain object, treating an empty file as `{}`.
 * Uses `isPlainObject` (not `isRecord`) so class instances are rejected for
 * prototype-pollution hardening; a YAML mapping always parses to a plain object.
 */
function parseTaktConfig(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = fileContent.trim() === "" ? {} : load(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Takt config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Takt config at ${configPath}: expected a YAML mapping`);
  }
  return parsed;
}

/**
 * Map a rulesync MCP server onto the single Takt transport its allowlist gates.
 *
 * Takt allows only `stdio` / `sse` / `http`, so the broader rulesync alias set is
 * folded: `local` ⇒ stdio; `streamable-http` / `ws` ⇒ http. A server with no
 * explicit transport is treated as stdio when it carries a `command`, else as a
 * remote `http` server (it must have a `url`). Returns `undefined` only when the
 * shape is too ambiguous to classify.
 */
function transportOf(server: McpServer): TaktTransport | undefined {
  const declared = server.type ?? server.transport;
  switch (declared) {
    case "stdio":
    case "local":
      return "stdio";
    case "sse":
      return "sse";
    case "http":
    case "streamable-http":
    case "ws":
      return "http";
    default:
      break;
  }
  if (server.command !== undefined) {
    return "stdio";
  }
  if (server.url !== undefined || server.httpUrl !== undefined) {
    return "http";
  }
  return undefined;
}

/**
 * Derive Takt's `workflow_mcp_servers` allowlist from the transports present in
 * the rulesync servers. All three keys are emitted explicitly (default-deny made
 * visible): a transport is `true` only when at least one server uses it.
 *
 * Server entries are read defensively (record guard); prototype-pollution server
 * names are irrelevant here because no user-controlled key or value is written —
 * only the three fixed boolean keys are.
 */
function deriveTransportAllowlist(servers: McpServers): Record<TaktTransport, boolean> {
  const allowlist: Record<TaktTransport, boolean> = { stdio: false, sse: false, http: false };

  for (const server of Object.values(servers)) {
    if (!isRecord(server)) continue;
    const transport = transportOf(server as McpServer);
    if (transport) {
      allowlist[transport] = true;
    }
  }

  return allowlist;
}
