import { join } from "node:path";

import {
  OPENCLAW_CONFIG_DIR_PATH,
  OPENCLAW_CONFIG_FILE_NAME,
  OPENCLAW_MCP_CONFIG_KEY,
  OPENCLAW_MCP_SERVERS_KEY,
} from "../../constants/openclaw-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
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

const OPENCLAW_GLOBAL_ONLY_MESSAGE =
  "OpenClaw MCP is global-only; use --global to sync ~/.openclaw/openclaw.json";

/**
 * Single spelling of the openclaw.json codec/policy, matching its
 * `SHARED_CONFIG_OWNERSHIP` declaration: the file is JSON5, and a file whose
 * root is not an object is refused rather than replaced, since it also holds
 * every other Gateway setting.
 */
function parseOpenclawConfig(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json5",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

// `oauth` string keys OpenClaw reads besides `identity`; `authProfileId` and
// `scope` are trimmed and must not be empty, and the two URLs are URLs.
const OPENCLAW_OAUTH_STRING_KEYS = [
  "authProfileId",
  "scope",
  "redirectUrl",
  "clientMetadataUrl",
] as const;

const OPENCLAW_OAUTH_IDENTITIES = new Set(["shared", "per-requester"]);

/**
 * Copies the `oauth` keys OpenClaw accepts. A known key with a value its
 * schema rejects (an `identity` other than `shared` / `per-requester`, a blank
 * string) is dropped with a warning, since the Gateway would refuse to start
 * on it; keys OpenClaw does not know are left behind silently, as they belong
 * to other tools' `oauth` blocks.
 */
function copyOpenclawOauth({
  source,
  serverName,
  logger,
}: {
  source: Record<string, unknown>;
  serverName: string | undefined;
  logger: Logger | undefined;
}): Record<string, unknown> | undefined {
  const oauth: Record<string, unknown> = {};
  const dropped: string[] = [];
  if (source.identity !== undefined) {
    if (typeof source.identity === "string" && OPENCLAW_OAUTH_IDENTITIES.has(source.identity)) {
      oauth.identity = source.identity;
    } else {
      dropped.push("identity");
    }
  }
  for (const key of OPENCLAW_OAUTH_STRING_KEYS) {
    const value = source[key];
    if (value === undefined) continue;
    if (typeof value === "string" && value.trim() !== "") {
      oauth[key] = value;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0 && serverName !== undefined) {
    logger?.warn(
      `OpenClaw MCP: dropping invalid oauth ${dropped.map((key) => `"${key}"`).join(", ")} ` +
        `of ${quoteValueForWarning(serverName)}; OpenClaw's config validation would reject it.`,
    );
  }
  return Object.keys(oauth).length > 0 ? oauth : undefined;
}

const OPENCLAW_CODEX_APPROVAL_MODES = new Set(["auto", "prompt", "approve"]);

/**
 * Copies the OpenClaw-only per-server fields that have no canonical
 * counterpart — `auth`, `oauth`, the TLS controls, the timeouts in
 * milliseconds, `supportsParallelToolCalls` and the `codex` projection — from
 * `source` to `target`, in both directions. OpenClaw validates its config
 * strictly (`oauth`, `toolFilter` and `codex` are strict objects) and refuses
 * to start the Gateway on a value it rejects, so only the documented keys with
 * the documented value types are copied; a same-named key another tool reads
 * differently (Hermes' snake_case `oauth` keys, say) is left behind.
 *
 * @see https://github.com/openclaw/openclaw/blob/v2026.10.4/src/config/zod-schema.mcp-server.ts
 */
function copyOpenclawOnlyFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
  { serverName, logger }: { serverName?: string; logger?: Logger } = {},
): boolean {
  let copied = false;
  if (source.auth === "oauth") {
    target.auth = "oauth";
    copied = true;
  }
  if (isRecord(source.oauth)) {
    const oauth = copyOpenclawOauth({ source: source.oauth, serverName, logger });
    if (oauth) {
      target.oauth = oauth;
      copied = true;
    }
  }
  for (const key of ["clientCert", "clientKey"] as const) {
    if (typeof source[key] === "string") {
      target[key] = source[key];
      copied = true;
    }
  }
  for (const key of ["sslVerify", "supportsParallelToolCalls"] as const) {
    if (typeof source[key] === "boolean") {
      target[key] = source[key];
      copied = true;
    }
  }
  for (const key of ["requestTimeoutMs", "connectionTimeoutMs"] as const) {
    const value = source[key];
    if (typeof value === "number" && Number.isFinite(value) && value > 0) {
      target[key] = value;
      copied = true;
    }
  }
  if (isRecord(source.codex)) {
    const codex: Record<string, unknown> = {};
    if (isStringArray(source.codex.agents) && source.codex.agents.length > 0) {
      codex.agents = [...source.codex.agents];
    }
    const mode = source.codex.defaultToolsApprovalMode;
    if (typeof mode === "string" && OPENCLAW_CODEX_APPROVAL_MODES.has(mode)) {
      codex.defaultToolsApprovalMode = mode;
    }
    if (Object.keys(codex).length > 0) {
      target.codex = codex;
      copied = true;
    }
  }
  return copied;
}

/** A string map without pollution keys, or `undefined` when nothing is left. */
function copyStringMap(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    // OpenClaw also accepts numbers and booleans here; the canonical maps hold
    // strings only, so they are imported in their string form.
    if (typeof entry === "string") result[key] = entry;
    else if (typeof entry === "number" || typeof entry === "boolean") result[key] = String(entry);
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

/** A non-empty `toolFilter` list, trimmed of blank entries OpenClaw rejects. */
function toolFilterList(value: unknown): string[] | undefined {
  if (!isStringArray(value)) return undefined;
  const list = value.map((entry) => entry.trim()).filter((entry) => entry !== "");
  return list.length > 0 ? list : undefined;
}

function convertServerToOpenclaw({
  name,
  config,
  logger,
}: {
  name: string;
  config: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  if (declaresNoTransport(config)) {
    return warnAndSkipMcpServer({
      toolName: "OpenClaw",
      serverName: name,
      reason: "no transport",
      logger,
    });
  }

  const out: Record<string, unknown> = {};
  if (isRemoteMcpServer(config)) {
    const url = resolveRemoteMcpUrl(config);
    if (!url) {
      return warnAndSkipMcpServer({
        toolName: "OpenClaw",
        serverName: name,
        reason: "a remote transport without a url",
        logger,
      });
    }
    const stated = config.type ?? config.transport;
    if (stated === "ws" || (stated === undefined && /^wss?:\/\//i.test(url))) {
      return warnAndSkipMcpServer({
        toolName: "OpenClaw",
        serverName: name,
        reason:
          "a WebSocket transport, which OpenClaw does not offer (only streamable-http and sse)",
        logger,
      });
    }
    out.url = url;
    // OpenClaw's canonical field is `transport`; `type: "http"` is only a CLI
    // alias that `openclaw doctor --fix` rewrites, so `type` is never written.
    out.transport = stated === "sse" ? "sse" : "streamable-http";
    const headers = copyStringMap(config.headers);
    if (headers) out.headers = headers;
  } else {
    const [command, ...args] = resolveLocalMcpCommand(config);
    if (!command) {
      return warnAndSkipMcpServer({
        toolName: "OpenClaw",
        serverName: name,
        reason: "a stdio transport without a command",
        logger,
      });
    }
    out.command = command;
    if (args.length > 0) out.args = args;
    const env = copyStringMap(config.env);
    if (env) out.env = env;
    if (typeof config.cwd === "string") out.cwd = config.cwd;
  }

  // OpenClaw rejects a `disabled` key outright; `enabled: false` keeps the
  // definition without connecting it, and absent means enabled.
  if (config.disabled === true) out.enabled = false;

  const include = toolFilterList(config.enabledTools);
  const exclude = toolFilterList(config.disabledTools);
  if (include || exclude) {
    out.toolFilter = { ...(include && { include }), ...(exclude && { exclude }) };
  }

  copyOpenclawOnlyFields(config, out, { serverName: name, logger });
  return out;
}

/**
 * Converts canonical rulesync servers into OpenClaw `mcp.servers` entries.
 * Only keys OpenClaw accepts are written — never canonical-only ones such as
 * `type` or `disabled`, which its strict config validation would answer by
 * refusing to start the Gateway.
 */
function convertToOpenclawFormat({
  mcpServers,
  logger,
}: {
  mcpServers: McpServers;
  logger?: Logger;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    const converted = convertServerToOpenclaw({ name, config, logger });
    if (converted) result[name] = converted;
  }
  return result;
}

/**
 * Converts OpenClaw `mcp.servers` entries back into canonical rulesync
 * servers. OpenClaw-only fields go into the `openclaw.mcpServers` override
 * block (the whole server, since an override entry replaces the shared one for
 * that tool), so they survive an import/generate round trip without leaking
 * into every other tool's config.
 */
function convertFromOpenclawFormat(servers: Record<string, unknown>): {
  mcpServers: McpServers;
  openclawOverrides: McpServers;
} {
  const mcpServers: McpServers = {};
  const openclawOverrides: McpServers = {};

  for (const [name, config] of Object.entries(servers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const server: Record<string, unknown> = {};
    if (typeof config.command === "string") {
      server.command = config.command;
      if (isStringArray(config.args)) server.args = config.args;
      const env = copyStringMap(config.env);
      if (env) server.env = env;
      if (typeof config.cwd === "string") server.cwd = config.cwd;
    } else if (typeof config.url === "string") {
      server.type = config.transport === "sse" ? "sse" : "http";
      server.url = config.url;
      const headers = copyStringMap(config.headers);
      if (headers) server.headers = headers;
    }
    // Not the canonical `enabled: false`: in a rulesync source that drops the
    // server from every tool's output instead of keeping it switched off.
    if (config.enabled === false) server.disabled = true;
    if (isRecord(config.toolFilter)) {
      const include = toolFilterList(config.toolFilter.include);
      const exclude = toolFilterList(config.toolFilter.exclude);
      if (include) server.enabledTools = include;
      if (exclude) server.disabledTools = exclude;
    }

    mcpServers[name] = server;
    const openclawServer = { ...server };
    if (copyOpenclawOnlyFields(config, openclawServer)) {
      openclawOverrides[name] = openclawServer;
    }
  }

  return { mcpServers, openclawOverrides };
}

/**
 * OpenClaw MCP servers.
 *
 * OpenClaw keeps its MCP registry under `mcp.servers` of the Gateway config
 * `~/.openclaw/openclaw.json` (JSON5; global only — there is no project-scoped
 * MCP location). That file also holds credentials and every other Gateway
 * setting, so generation merges rulesync's servers into `mcp.servers` by name,
 * keeps servers rulesync does not define and every other key, and never deletes
 * the file.
 *
 * @see https://docs.openclaw.ai/gateway/config-extensions
 * @see https://docs.openclaw.ai/tools/mcp
 */
export class OpenclawMcp extends ToolMcp {
  private readonly config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.config = parseOpenclawConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override isDeletable(): boolean {
    // openclaw.json is the whole Gateway config, so it is never removed.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: OPENCLAW_CONFIG_DIR_PATH,
      relativeFilePath: OPENCLAW_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<OpenclawMcp> {
    if (!global) {
      throw new Error(OPENCLAW_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new OpenclawMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<OpenclawMcp> {
    if (!global) {
      throw new Error(OPENCLAW_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseOpenclawConfig(existingContent, filePath);

    // `mcp` is owned as a whole key, so its other members (such as
    // `sessionIdleTtlMs`) and the servers rulesync does not define are carried
    // over from the existing file; rulesync's servers replace same-named ones.
    const existingMcp = isRecord(existing[OPENCLAW_MCP_CONFIG_KEY])
      ? existing[OPENCLAW_MCP_CONFIG_KEY]
      : {};
    const existingServers = isRecord(existingMcp[OPENCLAW_MCP_SERVERS_KEY])
      ? existingMcp[OPENCLAW_MCP_SERVERS_KEY]
      : {};
    const converted = convertToOpenclawFormat({ mcpServers: rulesyncMcp.getMcpServers(), logger });
    const servers = { ...existingServers, ...converted };

    // Servers are merged, never retracted: one removed from the rulesync
    // source (or added by `openclaw mcp set`) stays here, so say which.
    const kept = Object.keys(existingServers).filter(
      (name) => !PROTOTYPE_POLLUTION_KEYS.has(name) && !Object.hasOwn(converted, name),
    );
    if (kept.length > 0) {
      logger?.warn(
        `OpenClaw MCP servers not defined in rulesync are kept in ${join(paths.relativeDirPath, paths.relativeFilePath)}: ` +
          `${kept.map((name) => quoteValueForWarning(name)).join(", ")}. ` +
          "Remove them with 'openclaw mcp unset <name>' if they are no longer wanted.",
      );
    }

    return new OpenclawMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          [OPENCLAW_MCP_CONFIG_KEY]: { ...existingMcp, [OPENCLAW_MCP_SERVERS_KEY]: servers },
        },
        filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcp = isRecord(this.config[OPENCLAW_MCP_CONFIG_KEY])
      ? this.config[OPENCLAW_MCP_CONFIG_KEY]
      : {};
    const servers = isRecord(mcp[OPENCLAW_MCP_SERVERS_KEY]) ? mcp[OPENCLAW_MCP_SERVERS_KEY] : {};
    const { mcpServers, openclawOverrides } = convertFromOpenclawFormat(servers);

    // Never spread the config itself: credentials, channels and the rest of
    // the Gateway settings must not leak into the rulesync source.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers,
          ...(Object.keys(openclawOverrides).length > 0 && {
            openclaw: { mcpServers: openclawOverrides },
          }),
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
  }: ToolMcpForDeletionParams): OpenclawMcp {
    return new OpenclawMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
