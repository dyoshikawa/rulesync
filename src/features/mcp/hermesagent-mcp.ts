import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  getHermesagentConfigSharedFileKey,
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
} from "../../utils/hermesagent.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import { applySharedConfigPatch, parseSharedConfig } from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const HERMESAGENT_GLOBAL_ONLY_MESSAGE =
  "Hermes Agent MCP is global-only; use --global to sync ~/.hermes/config.yaml";

/**
 * Resolves the canonical remote URL for a server (`url` or the `httpUrl` alias).
 */
function resolveHermesUrl(config: Record<string, unknown>): string | undefined {
  return (
    (typeof config.url === "string" ? config.url : undefined) ??
    (typeof config.httpUrl === "string" ? config.httpUrl : undefined)
  );
}

/**
 * Resolves the canonical timeout for a server (`timeout` or the `networkTimeout` alias).
 */
function resolveHermesTimeout(config: Record<string, unknown>): number | undefined {
  if (typeof config.timeout === "number") return config.timeout;
  if (typeof config.networkTimeout === "number") return config.networkTimeout;
  return undefined;
}

/**
 * String-valued `oauth` keys Hermes reads (`tools/mcp_oauth.py`,
 * `tools/mcp_oauth_device.py`, v0.21.3): the callback overrides, the
 * pre-registered client, the CIMD document override, the DCR registration
 * fields, the token-request `user_agent`, the login `flow` (`device` for
 * RFC 8628) and the space-separated `scope` string sent on registration and
 * device authorization.
 */
const HERMES_OAUTH_STRING_KEYS = [
  "redirect_uri",
  "redirect_host",
  "client_id",
  "client_secret",
  "client_name",
  "client_metadata_url",
  "token_endpoint_auth_method",
  "application_type",
  "user_agent",
  "flow",
  "scope",
] as const;

/**
 * Copies the `oauth` mapping of a server, keeping only the keys Hermes reads.
 *
 * Hermes reads a single `scope` string, never a `scopes` list; earlier Rulesync
 * versions wrote `scopes` regardless, which Hermes silently ignored. A `scopes`
 * list is therefore folded into `scope` (space-separated, the OAuth wire form)
 * when no `scope` is given, in both directions, so an authored list finally
 * reaches the authorization server and an old `config.yaml` imports cleanly.
 */
function copyHermesOauth(source: unknown): Record<string, unknown> | undefined {
  if (!isRecord(source)) {
    return undefined;
  }
  const oauth: Record<string, unknown> = {};
  for (const key of HERMES_OAUTH_STRING_KEYS) {
    if (typeof source[key] === "string") {
      oauth[key] = source[key];
    }
  }
  if (typeof oauth.scope !== "string" && isStringArray(source.scopes)) {
    oauth.scope = source.scopes.join(" ");
  }
  // Callback port for the browser flow; approval wait in seconds for the
  // device flow (default 300).
  for (const key of ["redirect_port", "timeout"] as const) {
    if (typeof source[key] === "number") {
      oauth[key] = source[key];
    }
  }
  // `cimd: false` forces Dynamic Client Registration over the Client ID
  // Metadata Document.
  if (typeof source.cimd === "boolean") {
    oauth.cimd = source.cimd;
  }
  return Object.keys(oauth).length > 0 ? oauth : undefined;
}

// Per-server mappings Hermes reads as a whole; see `copyHermesAdvancedFields`.
const HERMES_OPAQUE_MAPPING_KEYS = [
  "sampling",
  "elicitation",
  "identity_header",
  "lifecycle",
] as const;

/**
 * Copies the advanced Hermes-recognized per-server fields that have no canonical
 * alias — `auth` (`oauth` for OAuth 2.1/PKCE), mTLS `client_cert` (string PEM
 * path, or `[cert, key]`/`[cert, key, password]` list) and `client_key`,
 * `connect_timeout` (seconds), `supports_parallel_tool_calls`, `protocol`,
 * `lazy`, `keepalive_interval`, `elicitation`, `trust`, and `identity_header` —
 * verbatim from `source` to `target`. Field names are identical on both sides
 * (the canonical `McpServerSchema` is a `looseObject`), so this serves export
 * and import alike. See the Hermes mcp-config-reference.
 */
function copyHermesAdvancedFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): boolean {
  let copied = false;
  if (typeof source.auth === "string") {
    target.auth = source.auth;
    copied = true;
  }
  if (typeof source.client_cert === "string" || isStringArray(source.client_cert)) {
    target.client_cert = source.client_cert;
    copied = true;
  }
  if (typeof source.client_key === "string") {
    target.client_key = source.client_key;
    copied = true;
  }
  if (typeof source.connect_timeout === "number") {
    target.connect_timeout = source.connect_timeout;
    copied = true;
  }
  if (typeof source.supports_parallel_tool_calls === "boolean") {
    target.supports_parallel_tool_calls = source.supports_parallel_tool_calls;
    copied = true;
  }
  const oauth = copyHermesOauth(source.oauth);
  if (oauth) {
    target.oauth = oauth;
    copied = true;
  }
  for (const key of ["idle_timeout_seconds", "max_lifetime_seconds"] as const) {
    if (typeof source[key] === "number") {
      target[key] = source[key];
      copied = true;
    }
  }
  // Protocol-era negotiation (v0.21): `auto` (default), `stateless` or
  // `legacy`. Copied verbatim like `trust`, so a value upstream adds next is
  // not turned back into the default on regenerate.
  if (typeof source.protocol === "string") {
    target.protocol = source.protocol;
    copied = true;
  }
  // Defer the connection until a tool of the server is first used (v0.21;
  // default off, read as a boolean-ish value in `tools/mcp_tool_discovery.py`).
  if (typeof source.lazy === "boolean") {
    target.lazy = source.lazy;
    copied = true;
  }
  // TLS verification: `true`/`false` or a PEM CA-bundle path. Landed in the
  // same upstream mTLS PR as `client_cert`/`client_key` but was missed when
  // those were added, so a hand-written value was destroyed on regenerate.
  if (typeof source.ssl_verify === "boolean" || typeof source.ssl_verify === "string") {
    target.ssl_verify = source.ssl_verify;
    copied = true;
  }
  // Bypasses the fail-fast content-type probe for HTTP servers (v0.19.0).
  if (typeof source.skip_preflight === "boolean") {
    target.skip_preflight = source.skip_preflight;
    copied = true;
  }
  // Liveness ping cadence in seconds (v0.20.0; default 180, floored at 5).
  if (typeof source.keepalive_interval === "number") {
    target.keepalive_interval = source.keepalive_interval;
    copied = true;
  }
  // Trust tier: `full` (default) or `untrusted`, where every write-capable tool
  // call needs approval. Copied verbatim rather than validated — upstream reads
  // any unrecognized value as `untrusted`, so narrowing the accepted set here
  // would turn a typo into a silent privilege escalation on regenerate.
  if (typeof source.trust === "string") {
    target.trust = source.trust;
    copied = true;
  }
  // Mappings Hermes reads as a whole: `sampling` (server-initiated LLM request
  // policy: `enabled`, `model`, `max_tokens_cap`, …), `elicitation`
  // (server-initiated user-input requests, v0.20.0: `enabled`, `timeout`),
  // `identity_header` (per-user header for remote servers: `{name, value_from:
  // "static" | "profile", value}`) and `lifecycle` (the stdio recycle timeouts
  // `idle_timeout_seconds`/`max_lifetime_seconds`, which the top-level keys
  // take precedence over; `tools/mcp_tool_common.py`). Copied as opaque
  // objects so new sub-keys keep working; cloned so no reference is shared
  // with the source, with pollution keys dropped.
  for (const key of HERMES_OPAQUE_MAPPING_KEYS) {
    const mapping = source[key];
    if (isPlainObject(mapping)) {
      target[key] = omitPrototypePollutionKeys(structuredClone(mapping));
      copied = true;
    }
  }
  return copied;
}

/**
 * Builds Hermes's per-server `tools` block from a canonical server config. The
 * canonical `enabledTools`/`disabledTools` arrays become `include`/`exclude`,
 * and the boolean `promptsEnabled`/`resourcesEnabled` toggles become Hermes's
 * `prompts`/`resources` capability flags. Returns an empty object when the
 * server has no tool scoping (the caller omits the block in that case).
 *
 * Note: `promptsEnabled`/`resourcesEnabled` are canonical top-level keys rather
 * than a nested canonical `tools` object, because canonical `McpServerSchema.tools`
 * is reserved as a `string[]` (used by other tools) — reusing it for an object
 * would fail validation on the next `generate`.
 */
function buildHermesToolsBlock(config: Record<string, unknown>): Record<string, unknown> {
  const tools: Record<string, unknown> = {};
  if (isStringArray(config.enabledTools)) tools.include = config.enabledTools;
  if (isStringArray(config.disabledTools)) tools.exclude = config.disabledTools;
  if (typeof config.promptsEnabled === "boolean") tools.prompts = config.promptsEnabled;
  if (typeof config.resourcesEnabled === "boolean") tools.resources = config.resourcesEnabled;
  return tools;
}

/**
 * Applies a Hermes per-server `tools` block back onto a canonical server config
 * (inverse of {@link buildHermesToolsBlock}): `include`/`exclude` become
 * `enabledTools`/`disabledTools`, and `prompts`/`resources` become the boolean
 * `promptsEnabled`/`resourcesEnabled` top-level toggles.
 */
function applyHermesToolsBlock(
  hermesTools: Record<string, unknown>,
  server: Record<string, unknown>,
): void {
  if (isStringArray(hermesTools.include)) server.enabledTools = hermesTools.include;
  if (isStringArray(hermesTools.exclude)) server.disabledTools = hermesTools.exclude;
  if (typeof hermesTools.prompts === "boolean") server.promptsEnabled = hermesTools.prompts;
  if (typeof hermesTools.resources === "boolean") server.resourcesEnabled = hermesTools.resources;
}

/**
 * Converts a single rulesync canonical MCP server into a Hermes `mcp_servers:` entry.
 *
 * Hermes is close to the MCP spec but not identical: `command` must be a single
 * executable string (an array's tail folds into `args`), a server is disabled
 * via `enabled: false` (not the canonical `disabled: true`), remote servers use
 * `url`/`headers`, and per-server tool scoping lives under a `tools: { include,
 * exclude }` block (from the canonical `enabledTools`/`disabledTools`). Only
 * fields Hermes understands are emitted, so the shared `config.yaml` is not
 * polluted with canonical-only aliases (`type`, `httpUrl`, `networkTimeout`,
 * ...) — with one exception since v0.20.0: a canonical `sse` server is written
 * as Hermes's own `transport: sse`, without which Hermes would connect to it
 * over Streamable HTTP.
 */
function convertServerToHermes(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const command = config.command;
  const url = resolveHermesUrl(config);

  if (command !== undefined) {
    if (Array.isArray(command)) {
      if (typeof command[0] === "string") out.command = command[0];
      const rest = command.slice(1).filter((c): c is string => typeof c === "string");
      const args = isStringArray(config.args) ? config.args : [];
      if (rest.length > 0 || args.length > 0) out.args = [...rest, ...args];
    } else if (typeof command === "string") {
      out.command = command;
      if (isStringArray(config.args)) out.args = config.args;
    }
    if (isPlainObject(config.env)) out.env = omitPrototypePollutionKeys(config.env);
  } else if (url !== undefined) {
    out.url = url;
    if (isPlainObject(config.headers)) out.headers = omitPrototypePollutionKeys(config.headers);
    // Hermes speaks Streamable HTTP to a `url` server unless told otherwise, so
    // a canonical `sse` server has to say so (v0.20.0). Only `sse` is a value
    // upstream reads; the canonical `http` spellings are the default and stay
    // implicit, as they were before this key existed.
    if (config.type === "sse" || config.transport === "sse") out.transport = "sse";
  }

  // Hermes defaults a server to enabled, so only emit the flag when disabling.
  if (config.disabled === true) out.enabled = false;

  const timeout = resolveHermesTimeout(config);
  if (timeout !== undefined) out.timeout = timeout;

  // Advanced Hermes-recognized per-server fields (auth/mTLS/timeout/parallel).
  copyHermesAdvancedFields(config, out);

  // Per-server selective tool loading. Canonical `enabledTools`/`disabledTools`
  // map to Hermes's `tools: { include, exclude }` block (include = whitelist,
  // exclude = denylist; see hermes-agent `apps/desktop/src/lib/mcp-tool-filter.ts`
  // and `tools/mcp_tool.py`'s `_register_server_tools`); the boolean
  // `promptsEnabled`/`resourcesEnabled` toggles map to Hermes's `prompts`/`resources`.
  const tools = buildHermesToolsBlock(config);
  if (Object.keys(tools).length > 0) out.tools = tools;

  return out;
}

/**
 * Converts rulesync canonical MCP servers into Hermes `mcp_servers:` entries.
 */
function convertToHermesFormat(mcpServers: McpServers): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    result[name] = convertServerToHermes(config);
  }

  return result;
}

function mergeHermesMcpServers(
  config: Record<string, unknown>,
  mcpServers: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const existingMcpServers = isRecord(config.mcp_servers) ? config.mcp_servers : {};

  return {
    ...config,
    mcp_servers: {
      ...existingMcpServers,
      ...mcpServers,
    },
  };
}

/**
 * Converts Hermes `mcp_servers:` entries back into rulesync canonical MCP servers.
 *
 * Mirrors {@link convertToHermesFormat}: `enabled: false` maps back to the
 * canonical `disabled: true`, and only recognized fields are carried over.
 */
function convertFromHermesFormat(mcpServers: Record<string, unknown>): {
  mcpServers: McpServers;
  hermesOverrides: McpServers;
} {
  const result: McpServers = {};
  const hermesOverrides: McpServers = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const server: Record<string, unknown> = {};
    if (typeof config.command === "string") server.command = config.command;
    if (isStringArray(config.args)) server.args = config.args;
    if (isPlainObject(config.env)) server.env = omitPrototypePollutionKeys(config.env);
    if (typeof config.url === "string") server.url = config.url;
    if (isPlainObject(config.headers)) server.headers = omitPrototypePollutionKeys(config.headers);
    // The counterpart of the generate direction: `transport: sse` is the only
    // value Hermes reads, and it maps onto the canonical `sse` transport.
    if (typeof config.url === "string" && config.transport === "sse") server.type = "sse";
    if (config.enabled === false) server.disabled = true;
    if (typeof config.timeout === "number") server.networkTimeout = config.timeout;
    if (isRecord(config.tools)) applyHermesToolsBlock(config.tools, server);

    result[name] = server;
    const hermesServer = { ...server };
    if (copyHermesAdvancedFields(config, hermesServer)) {
      hermesOverrides[name] = hermesServer;
    }
  }

  return { mcpServers: result, hermesOverrides };
}

/**
 * Hermes Agent MCP servers.
 *
 * Hermes Agent configures MCP servers under the top-level `mcp_servers` key of
 * the shared user config file `~/.hermes/config.yaml` (the HERMES_HOME directory;
 * global only — Hermes has no project-scoped MCP location). That file also holds
 * other Hermes settings (model, terminal, ...), so generation merges the
 * `mcp_servers:` block into the existing config instead of overwriting it, and
 * the file is never deleted.
 */
export class HermesagentMcp extends ToolMcp {
  private config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.config =
      this.fileContent !== undefined
        ? parseSharedConfig({ format: "yaml", fileContent: this.fileContent })
        : {};
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override shouldMergeExistingFileContent(): boolean {
    return true;
  }

  override setFileContent(fileContent: string): void {
    const config = parseSharedConfig({ format: "yaml", fileContent });
    const mcpServers = isRecord(this.config.mcp_servers) ? this.config.mcp_servers : {};
    const merged = mergeHermesMcpServers(
      config,
      mcpServers as Record<string, Record<string, unknown>>,
    );

    this.config = merged;
    super.setFileContent(
      applySharedConfigPatch({
        fileKey: getHermesagentConfigSharedFileKey({ global: this.global }),
        feature: "mcp",
        existingContent: fileContent,
        patch: { mcp_servers: merged.mcp_servers },
      }),
    );
  }

  override isDeletable(): boolean {
    // config.yaml holds other Hermes settings, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: getHermesagentRelativeDirPath({
        global,
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      }),
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  /**
   * `config.yaml` under every spelling the global profile root can take.
   * @see getHermesagentSharedConfigWritePaths
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return getHermesagentSharedConfigWritePaths();
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new HermesagentMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "";
    const config = parseSharedConfig({ format: "yaml", fileContent });

    // Merge the `mcp_servers:` block into the shared config, preserving other
    // keys (model, terminal, ...).
    const merged = mergeHermesMcpServers(
      config,
      convertToHermesFormat(rulesyncMcp.getMcpServers()),
    );

    return new HermesagentMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: getHermesagentConfigSharedFileKey({ global }),
        feature: "mcp",
        existingContent: fileContent,
        patch: { mcp_servers: merged.mcp_servers },
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isRecord(this.config.mcp_servers) ? this.config.mcp_servers : {};
    const { mcpServers: servers, hermesOverrides } = convertFromHermesFormat(mcpServers);
    return this.toRulesyncMcpDefault({
      outputRoot: getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      fileContent: JSON.stringify(
        {
          mcpServers: servers,
          ...(Object.keys(hermesOverrides).length > 0 && {
            hermesagent: { mcpServers: hermesOverrides },
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
  }: ToolMcpForDeletionParams): HermesagentMcp {
    return new HermesagentMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
