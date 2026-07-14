import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
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
 * Copies the advanced Hermes-recognized per-server fields that have no canonical
 * alias — `auth` (`oauth` for OAuth 2.1/PKCE), mTLS `client_cert` (string PEM
 * path, or `[cert, key]`/`[cert, key, password]` list) and `client_key`,
 * `connect_timeout` (seconds), and `supports_parallel_tool_calls` — verbatim
 * from `source` to `target`. Field names are identical on both sides (the
 * canonical `McpServerSchema` is a `looseObject`), so this serves export and
 * import alike. See the Hermes mcp-config-reference.
 */
function copyHermesAdvancedFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): void {
  if (typeof source.auth === "string") target.auth = source.auth;
  if (typeof source.client_cert === "string" || isStringArray(source.client_cert)) {
    target.client_cert = source.client_cert;
  }
  if (typeof source.client_key === "string") target.client_key = source.client_key;
  if (typeof source.connect_timeout === "number") target.connect_timeout = source.connect_timeout;
  if (typeof source.supports_parallel_tool_calls === "boolean") {
    target.supports_parallel_tool_calls = source.supports_parallel_tool_calls;
  }
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
 * polluted with canonical-only aliases (`type`, `transport`, `httpUrl`,
 * `networkTimeout`, ...).
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
function convertFromHermesFormat(mcpServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const server: Record<string, unknown> = {};
    if (typeof config.command === "string") server.command = config.command;
    if (isStringArray(config.args)) server.args = config.args;
    if (isPlainObject(config.env)) server.env = omitPrototypePollutionKeys(config.env);
    if (typeof config.url === "string") server.url = config.url;
    if (isPlainObject(config.headers)) server.headers = omitPrototypePollutionKeys(config.headers);
    if (config.enabled === false) server.disabled = true;
    if (typeof config.timeout === "number") server.networkTimeout = config.timeout;
    // Advanced Hermes-recognized fields with no canonical alias round-trip
    // verbatim (see convertServerToHermes).
    copyHermesAdvancedFields(config, server);
    if (isRecord(config.tools)) applyHermesToolsBlock(config.tools, server);

    result[name] = server;
  }

  return result;
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
        fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
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

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
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

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      "",
    );
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
        fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
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
    const servers = convertFromHermesFormat(mcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: servers }, null, 2),
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
