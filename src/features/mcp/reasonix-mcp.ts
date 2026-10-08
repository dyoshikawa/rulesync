import { join } from "node:path";

import * as smolToml from "smol-toml";

import {
  REASONIX_GLOBAL_DIR,
  REASONIX_GLOBAL_MCP_FILE_NAME,
  REASONIX_PROJECT_MCP_FILE_NAME,
} from "../../constants/reasonix-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type ReasonixConfig = Record<string, unknown> & {
  plugins?: ReasonixPlugin[];
};

type ReasonixPlugin = Record<string, unknown> & {
  name: string;
  type?: string;
};

// Reasonix declares an external plugin (MCP server) as a `[[plugins]]`
// array-of-tables entry. `type` selects the transport — `stdio` (default),
// `http` (a.k.a. `streamable-http`) or `sse` (the legacy HTTP+SSE transport);
// the remaining fields mirror the standard MCP schema.
// `trusted_read_only_tools` is neither written nor imported: v1.17.18 retired it
// along with `default_tools_approval_mode`, `tools.<raw>.approval_mode` and
// `approvals_reviewer` — installing a server is now the authorization decision,
// and Reasonix ignores the key on load. Importing it would put a Reasonix-only
// dead key into the canonical `mcpServers` that every MCP target writes out, so
// it would surface in `.mcp.json` and the rest. Rulesync owns `plugins`, so the
// next generate drops it from an older file too — which loses nothing Reasonix
// still reads. The remaining fields have no deep canonical mapping and
// round-trip as passthrough fields on the canonical McpServer (a loose zod
// object, so unknown keys survive), mirroring how other MCP adapters
// preserve server-specific extra fields they don't deeply model.
// `startup_timeout_seconds` caps the background
// launch/authorization/`initialize`/`tools/list` sequence, overriding the global
// `mcp_startup_timeout_seconds`. Canonical `networkTimeout` covers the same
// phase (Codex CLI deep-maps it to `startup_timeout_sec`), but it is NOT mapped
// here: canonical timeouts are milliseconds while this is seconds, and `0` is
// meaningful to Reasonix — defer to the global cap — with no canonical spelling,
// so translating would either invent a value or lose one. It therefore passes
// through verbatim, as Vibe does with its own `startup_timeout_sec`.
// `call_timeout_seconds` (per-server MCP call timeout) and `tool_timeout_seconds`
// (a per-tool inline table keyed by raw MCP tool name) have no canonical
// equivalent at all and round-trip as passthrough fields too.
// `concurrency` (`serial` | `parallel`, with no value meaning the server name
// decides) and `auto_start` are the same kind of passthrough. Both matter more
// than their size suggests, because
// rulesync rewrites the whole `plugins` key: a value only Reasonix knows about
// would be deleted on the next generate, and for these two that deletion changes
// behavior rather than losing a hint. `serial` is what keeps sub-agents sharing
// one stdio process from interleaving on its session state. Reasonix reads an
// explicit value first and otherwise substring-matches the server name against a
// known-stateful list (browser, playwright, puppeteer, chrome, chromium,
// selenium), so dropping the key does not fall back to a neutral default — it
// hands the decision to the name: a `serial` dropped from a server the list does
// not catch puts it back on the parallel path, and a `parallel` dropped from one
// it does catch forces it serial. `auto_start = false` is not a delay: it takes
// the server out of the enabled set entirely (`Config.EnabledPlugins` in
// `internal/config/config.go`), so its tools never reach the model and Reasonix
// reports it as `disabled` rather than `deferred`. Nothing a tool call does
// brings it back — only a durable override in `mcp-activation.json`, written
// when the user enables the server, outranks the file value. Dropping the key
// therefore switches a server back on. `concurrency` has no canonical
// counterpart. `auto_start` is authorable as a passthrough on generate, but
// canonical `disabled` feeds it too (`resolveAutoStart`): `disabled: true` is
// always written as `auto_start = false`, the switch Reasonix reads as
// "disabled" — a stop the user asked for across every tool is not overridden
// by a stale tool-specific `true` — and an authored `auto_start` applies only
// when the server is not disabled. On import `auto_start` is not kept as a
// passthrough: `false` lifts to `disabled: true` and `true` is the default, so
// the canonical `disabled` stays the one switch and a later edit to it is not
// shadowed by a value import left behind. The activation store can still flip
// a server independently of the file; that is runtime state, not config.
// The CLI v2 line (v2.31.0, `internal/contract/config/plugin_entry.go`) adds
// `load` (`always` puts the server's tools in the provider schema from session
// start; empty or `deferred` reaches them through `use_capability`) and
// `oauth_allow_missing_pkce_metadata`, both passthrough, and `disabled_tools`,
// a per-server denylist of raw tool names that deep-maps to canonical
// `disabledTools`. The v1 line ignores unknown keys, so writing them is harmless
// there.
// The scalar passthrough fields with a fixed type are also value-checked on the
// way out (`invalidPassthroughFieldReason`): Reasonix decodes `reasonix.toml`
// with BurntSushi/toml into a `string` / `*bool` / `bool`, and a type mismatch
// fails the load of the whole file, not just this entry. The other passthrough
// fields are not checked yet.
// @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
// (§3.16 for `concurrency`) and `internal/config/plugin_entry.go` for the
// `[[plugins]]` field names.
const REASONIX_PLUGIN_FIELDS = [
  "type",
  "command",
  "args",
  "env",
  "url",
  "headers",
  "startup_timeout_seconds",
  "call_timeout_seconds",
  "tool_timeout_seconds",
  "concurrency",
  "auto_start",
  "load",
  "oauth_allow_missing_pkce_metadata",
] as const;

/** The `[[plugins]]` key that canonical `disabledTools` is written to and read from. */
const REASONIX_DISABLED_TOOLS_KEY = "disabled_tools";

export class ReasonixMcp extends ToolMcp {
  private readonly toml: ReasonixConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.toml = parseReasonixConfig(this.fileContent);
  }

  getToml(): ReasonixConfig {
    return this.toml;
  }

  /**
   * The Reasonix config file may hold many other settings (providers, ui, agent,
   * …), so it must never be deleted when no MCP servers remain.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Project config lives at the repository root (`./reasonix.toml`), while the
    // global config lives at `~/.reasonix/config.toml`; the home root is supplied
    // by the processor via outputRoot.
    if (global) {
      return {
        relativeDirPath: REASONIX_GLOBAL_DIR,
        relativeFilePath: REASONIX_GLOBAL_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: REASONIX_PROJECT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ReasonixMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const config = parseReasonixConfig(fileContent);
    config.plugins = normalizePluginsArray(config.plugins);

    return new ReasonixMcp({
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
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<ReasonixMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    const plugins = Object.entries(rulesyncMcp.getMcpServers())
      .map(([name, server]) => rulesyncMcpServerToReasonix(name, server, logger))
      .filter((plugin) => plugin !== null);

    return new ReasonixMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: { plugins },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers: McpServers = Object.fromEntries(
      normalizePluginsArray(this.toml.plugins).map((plugin) => [
        plugin.name,
        reasonixPluginToRulesync(plugin),
      ]),
    );

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseReasonixConfig(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Reasonix config TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ReasonixMcp {
    return new ReasonixMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}

function parseReasonixConfig(fileContent: string): ReasonixConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

function normalizePluginsArray(value: unknown): ReasonixPlugin[] {
  if (!Array.isArray(value)) {
    return [];
  }
  return value
    .filter((entry): entry is Record<string, unknown> => {
      return entry !== null && typeof entry === "object" && !Array.isArray(entry);
    })
    .filter((entry): entry is ReasonixPlugin => typeof entry.name === "string");
}

// The transports Reasonix implements. Anything else — `ws`, or a value a future
// rulesync alias introduces — would be written as a `type` its loader rejects, so the
// server is skipped instead.
// https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
const REASONIX_TRANSPORTS: ReadonlySet<string> = new Set(["stdio", "http", "sse"]);

/**
 * Fields an older `reasonix.toml` may carry that v1.17.18 retired. Neither
 * written nor imported; named here only so a canonical config still holding one
 * can say what it is dropping.
 */
const REASONIX_RETIRED_PLUGIN_FIELDS = ["trusted_read_only_tools"] as const;

/**
 * Only reachable from a canonical config an older rulesync imported into, since
 * this adapter no longer imports the field. Rulesync owns `plugins`, so staying
 * silent would take it out of the user's file without a word.
 */
function warnAboutRetiredFields({
  name,
  serverRecord,
  logger,
}: {
  name: string;
  serverRecord: Record<string, unknown>;
  logger?: Logger;
}): void {
  for (const field of REASONIX_RETIRED_PLUGIN_FIELDS) {
    if (serverRecord[field] !== undefined) {
      logger?.warn(
        `Reasonix MCP: dropping "${field}" from "${name}"; Reasonix retired the field in ` +
          `v1.17.18 and ignores it, so it is no longer written.`,
      );
    }
  }
}

/**
 * The `concurrency` values Reasonix honors. It trims and lowercases before
 * comparing (`mcpServerIsSerial` in `internal/agent/mcp_concurrency.go`), so
 * `" Serial "` counts too and is written as authored.
 */
const REASONIX_CONCURRENCY_VALUES: ReadonlySet<string> = new Set(["serial", "parallel"]);

/**
 * The type Reasonix decodes each fixed-type scalar passthrough field into
 * (`PluginEntry` in `internal/config/plugin_entry.go`, and
 * `internal/contract/config/plugin_entry.go` on the CLI v2 line).
 */
const REASONIX_TYPED_PLUGIN_FIELDS: Readonly<Record<string, "string" | "boolean">> = {
  concurrency: "string",
  auto_start: "boolean",
  load: "string",
  oauth_allow_missing_pkce_metadata: "boolean",
};

/**
 * Why a passthrough value cannot be written, or `undefined` when it can (and
 * for every field without a fixed type). A wrong type is the case that matters:
 * a TOML type mismatch makes Reasonix refuse the whole config file. An unknown
 * `concurrency` string decodes fine but is ignored in favor of the server-name
 * default, so it is dropped too rather than written as a setting that does
 * nothing. An unknown `load` string is read as `deferred`, the default, so it
 * passes through as authored.
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/internal/config/plugin_entry.go
 */
function invalidPassthroughFieldReason(field: string, value: unknown): string | undefined {
  const expected = REASONIX_TYPED_PLUGIN_FIELDS[field];
  if (expected !== undefined && typeof value !== expected) {
    return `Reasonix expects a ${expected} and fails to load a config file holding any other type.`;
  }
  if (
    field === "concurrency" &&
    typeof value === "string" &&
    !REASONIX_CONCURRENCY_VALUES.has(value.trim().toLowerCase())
  ) {
    return (
      `Reasonix accepts only "serial" or "parallel" and ignores ${JSON.stringify(value)}, ` +
      `falling back to the server-name default.`
    );
  }
  return undefined;
}

/**
 * The `auto_start` to write: `false` for a canonical `disabled: true`, which is
 * how Reasonix spells a server that is off (`Config.EnabledPlugins` leaves it
 * out of the enabled set), whatever the server's own `auto_start` says — the
 * fail-safe direction, since the user stopped the server for every tool.
 * Otherwise the server's own `auto_start`. `undefined` means the key is left
 * out, which Reasonix reads as enabled.
 */
function resolveAutoStart({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServer;
  logger?: Logger;
}): unknown {
  const authored = (server as Record<string, unknown>).auto_start;
  if (server.disabled === true) {
    if (authored !== undefined && authored !== false) {
      logger?.warn(
        `Reasonix MCP: "${name}" is disabled, so "auto_start" is written as false ` +
          `instead of ${JSON.stringify(authored)}.`,
      );
    }
    return false;
  }
  return authored;
}

function writePassthroughFields({
  name,
  server,
  plugin,
  logger,
}: {
  name: string;
  server: McpServer;
  plugin: ReasonixPlugin;
  logger?: Logger;
}): void {
  const serverRecord = server as Record<string, unknown>;
  for (const field of REASONIX_PLUGIN_FIELDS) {
    if (field === "type" || field === "command" || field === "args") {
      continue;
    }
    const value =
      field === "auto_start" ? resolveAutoStart({ name, server, logger }) : serverRecord[field];
    if (value === undefined) {
      continue;
    }
    const invalidReason = invalidPassthroughFieldReason(field, value);
    if (invalidReason !== undefined) {
      logger?.warn(`Reasonix MCP: dropping "${field}" from "${name}"; ${invalidReason}`);
      continue;
    }
    if (field === "oauth_allow_missing_pkce_metadata" && value === true) {
      logger?.warn(
        `Reasonix MCP: "${name}" sets "oauth_allow_missing_pkce_metadata", which lets OAuth ` +
          `proceed with an authorization server that does not advertise PKCE support. ` +
          `Reasonix honours it only from the user config, not a project reasonix.toml.`,
      );
    }
    plugin[field] = value;
  }
}

function rulesyncMcpServerToReasonix(
  name: string,
  server: McpServer,
  logger?: Logger,
): ReasonixPlugin | null {
  const serverRecord = server as Record<string, unknown>;
  const type = resolveReasonixType(server);
  if (type !== undefined && !REASONIX_TRANSPORTS.has(type)) {
    logger?.warn(
      `Reasonix MCP: skipping "${name}" because it uses the "${type}" transport, which Reasonix ` +
        `does not implement; writing it would produce a config Reasonix cannot load.`,
    );
    return null;
  }
  const plugin: ReasonixPlugin = {
    name,
    ...(type !== undefined && { type }),
  };

  if (server.command !== undefined) {
    if (Array.isArray(server.command)) {
      const [command, ...commandArgs] = server.command;
      if (command !== undefined) {
        plugin.command = command;
      }
      const args = [...commandArgs, ...(server.args ?? [])];
      if (args.length > 0) {
        plugin.args = args;
      }
    } else {
      plugin.command = server.command;
      if (server.args !== undefined) {
        plugin.args = server.args;
      }
    }
  }

  writePassthroughFields({ name, server, plugin, logger });
  // The canonical schema already types `disabledTools` as a string list. A
  // blank name is dropped (Reasonix's own editor rejects it), and an empty
  // list is skipped: Reasonix reads it as "every tool enabled", the same as no
  // key.
  const disabledTools = (server.disabledTools ?? []).filter((tool) => tool.trim() !== "");
  if (disabledTools.length !== (server.disabledTools ?? []).length) {
    logger?.warn(`Reasonix MCP: dropping blank "disabledTools" entries from "${name}".`);
  }
  if (disabledTools.length > 0) {
    plugin[REASONIX_DISABLED_TOOLS_KEY] = disabledTools;
  }
  warnAboutRetiredFields({ name, serverRecord, logger });
  if (plugin.url === undefined && server.httpUrl !== undefined) {
    plugin.url = server.httpUrl;
  }

  return plugin;
}

function reasonixPluginToRulesync(plugin: ReasonixPlugin): McpServer {
  const result: Record<string, unknown> = {};
  const type = typeof plugin.type === "string" ? plugin.type : undefined;
  if (type !== undefined) {
    result.type = type;
  }

  for (const field of REASONIX_PLUGIN_FIELDS) {
    if (field === "type" || field === "auto_start") {
      continue;
    }
    if (plugin[field] !== undefined) {
      result[field] = plugin[field];
    }
  }
  if (plugin.auto_start === false) {
    result.disabled = true;
  }
  // Only the string entries are kept: a non-string one is a file Reasonix
  // cannot load anyway, and dropping the whole list would lift every
  // restriction on the other targets.
  const disabledTools = plugin[REASONIX_DISABLED_TOOLS_KEY];
  const disabledToolNames = Array.isArray(disabledTools)
    ? disabledTools.filter((tool): tool is string => typeof tool === "string")
    : [];
  if (disabledToolNames.length > 0) {
    result.disabledTools = disabledToolNames;
  }

  return result as McpServer;
}

function resolveReasonixType(server: McpServer): string | undefined {
  // Reasonix transports: `stdio` (default), `http` (a.k.a. `streamable-http`),
  // and `sse` — the legacy 2024-11-05 HTTP+SSE transport, which v1.17.18
  // re-implemented rather than deferred. Collapsing it onto `http` would point
  // Reasonix at Streamable HTTP and the server would not connect, so it is
  // emitted verbatim. `local` is the rulesync alias for `stdio`.
  // https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
  const candidate = server.type ?? server.transport;
  if (candidate) {
    if (candidate === "streamable-http") {
      return "http";
    }
    if (candidate === "local") {
      return "stdio";
    }
    return candidate;
  }
  if (server.command) {
    return "stdio";
  }
  const url = server.url ?? server.httpUrl;
  if (typeof url === "string") {
    // With no `type` to go on, the URL scheme decides: a `ws://`/`wss://` server
    // takes the same unsupported path rather than being guessed at as `http`
    // and written as a config that cannot connect. An explicit `type` is taken
    // at its word above, so a stated `http` with a `wss://` URL still goes
    // through — the author said what they meant.
    return /^wss?:\/\//i.test(url) ? "ws" : "http";
  }
  return undefined;
}
