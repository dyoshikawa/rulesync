import { join } from "node:path";

import {
  MUSECODE_GLOBAL_CONFIG_DIR_PATH,
  MUSECODE_SETTINGS_FILE_NAME,
  MUSECODE_SETTINGS_SCHEMA_VERSION,
} from "../../constants/musecode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord } from "../../utils/type-guards.js";
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

const MUSECODE_GLOBAL_ONLY_MESSAGE =
  "Muse Code MCP is global-only; use --global to sync ~/.config/muse/settings.json";

/**
 * Single spelling of the settings.json codec/policy, matching the
 * `SHARED_CONFIG_OWNERSHIP` declaration for `.config/muse/settings.json`:
 * fail closed on an unparseable root rather than replacing the user's primary
 * Muse Code config with generated output.
 */
function parseMusecodeSettings(fileContent: string, filePath?: string): Record<string, unknown> {
  return parseSharedConfig({
    format: "json",
    fileContent,
    filePath,
    invalidRootPolicy: "error",
  });
}

/**
 * The settings key holding the MCP server map. `mcp_servers` is the documented
 * spelling; since 0.2.1 Muse Code also accepts the ecosystem-standard
 * `mcpServers` (changelog: "Settings accept the standard `mcpServers` key"),
 * which its own `muse mcp` commands may write. A file that already uses only
 * `mcpServers` keeps that spelling, so rulesync never adds a second MCP block
 * beside it; otherwise — including a file carrying both — `mcp_servers` wins.
 * Which block Muse Code reads when both are present is not documented.
 *
 * @see https://dev.meta.ai/docs/muse-code/changelog
 */
type MusecodeServersKey = "mcp_servers" | "mcpServers";

function resolveMusecodeServersKey(settings: Record<string, unknown>): MusecodeServersKey {
  return !Object.hasOwn(settings, "mcp_servers") && Object.hasOwn(settings, "mcpServers")
    ? "mcpServers"
    : "mcp_servers";
}

function hasBothMusecodeServersKeys(settings: Record<string, unknown>): boolean {
  return Object.hasOwn(settings, "mcp_servers") && Object.hasOwn(settings, "mcpServers");
}

const BOTH_SERVERS_KEYS_WARNING =
  "Muse Code MCP: settings.json carries both `mcp_servers` and `mcpServers`; Rulesync " +
  "uses `mcp_servers` and leaves `mcpServers` untouched. Merge them into one block, since " +
  "Muse Code does not document which one it reads.";

/**
 * The whole documented `mode` vocabulary: `required` (Muse Code's default)
 * aborts the run when the server fails to start, `optional` skips it with a
 * warning. Anything else is not a mode Muse Code implements, so every direction
 * treats it as absent rather than writing it out or lifting it into the
 * `musecodeMode` authoring key, which is typed as exactly these two values.
 *
 * @see https://dev.meta.ai/docs/muse-code/extending.md
 */
function asMusecodeMode(value: unknown): "required" | "optional" | undefined {
  return value === "required" || value === "optional" ? value : undefined;
}

/**
 * Canonical millisecond timeouts and the Muse Code per-server fields they
 * translate to (the Codex CLI mapping, `codexcli-mcp.ts`):
 * - `timeout` → `tool_timeout_sec`: applies to tool calls, resource reads and
 *   prompt fetches on both transports (changelog 1.1.1; 1.4.0 lets values above
 *   600 seconds take effect, which pins the unit).
 * - `networkTimeout` → `startup_timeout_sec`: the server startup budget, honored
 *   since 1.2.1.
 *
 * Muse Code does not document whether fractional seconds are accepted, so the
 * value is rounded up to whole seconds — never shorter than authored — and only
 * a positive timeout is written, since what `0` means to Muse Code is not
 * documented either.
 *
 * @see https://dev.meta.ai/docs/muse-code/changelog
 */
const RULESYNC_TO_MUSECODE_TIMEOUT_FIELD_MAP = {
  timeout: "tool_timeout_sec",
  networkTimeout: "startup_timeout_sec",
} as const;

const MUSECODE_TO_RULESYNC_TIMEOUT_FIELD_MAP: Record<string, string> = Object.fromEntries(
  Object.entries(RULESYNC_TO_MUSECODE_TIMEOUT_FIELD_MAP).map(([canonical, musecode]) => [
    musecode,
    canonical,
  ]),
);

const MILLISECONDS_PER_SECOND = 1000;

function isPositiveTimeout(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

function toMusecodeTimeouts(config: Record<string, unknown>): Record<string, number> {
  const timeouts: Record<string, number> = {};
  for (const [canonicalKey, musecodeKey] of Object.entries(
    RULESYNC_TO_MUSECODE_TIMEOUT_FIELD_MAP,
  )) {
    const value = config[canonicalKey];
    if (isPositiveTimeout(value)) {
      timeouts[musecodeKey] = Math.ceil(value / MILLISECONDS_PER_SECOND);
    }
  }
  return timeouts;
}

/** A stdio server's working directory; an empty string is not a directory. */
function toMusecodeCwd(cwd: unknown): { cwd?: string } {
  return typeof cwd === "string" && cwd !== "" ? { cwd } : {};
}

/**
 * Convert canonical rulesync servers to Muse Code's native `mcp_servers` shape.
 * Each entry carries a `transport` discriminator: `stdio` servers spawn a
 * `command` (single string) with `args`/`env`, and `streamable_http` servers
 * are reached at a `url` with optional `headers`; a stdio server's `cwd` is its
 * working directory (honored since 1.2.1). Only documented fields are
 * emitted; a canonical `disabled: true` maps to Muse's `enabled: false`, the
 * canonical millisecond timeouts become whole-second `*_timeout_sec` fields, and
 * the authoring key `musecodeMode` is written out under Muse Code's own name,
 * `mode`.
 */
function convertToMusecodeFormat(mcpServers: McpServers, logger?: Logger): Record<string, unknown> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
    if (!isRecord(config)) continue;

    if (declaresNoTransport(config)) {
      warnAndSkipMcpServer({
        toolName: "Muse Code",
        serverName: name,
        reason: "no transport",
        logger,
      });
      continue;
    }

    const converted: Record<string, unknown> = {};
    if (isRemoteMcpServer(config)) {
      const url = resolveRemoteMcpUrl(config);
      if (!url) {
        warnAndSkipMcpServer({
          toolName: "Muse Code",
          serverName: name,
          reason: "a remote transport without a url",
          logger,
        });
        continue;
      }
      // `streamable_http` is Muse Code's only documented remote transport. A
      // server that states `sse` or `ws` does not speak it, so rewriting the
      // entry would hand Muse Code a server it cannot connect to; those are
      // skipped out loud instead (the rovodev `ws` / reasonix `sse` precedent).
      // An explicit `type` is taken at its word; with none stated, a
      // `ws://`/`wss://` URL takes the same unsupported path rather than being
      // guessed at as HTTP.
      const stated = config.type ?? config.transport;
      const unsupportedRemote =
        stated === "sse" || stated === "ws" || (stated === undefined && /^wss?:\/\//i.test(url));
      if (unsupportedRemote) {
        warnAndSkipMcpServer({
          toolName: "Muse Code",
          serverName: name,
          reason: `the "${stated ?? "ws"}" transport, which Muse Code does not implement (only stdio and streamable_http are supported)`,
          logger,
        });
        continue;
      }
      converted.transport = "streamable_http";
      converted.url = url;
      if (config.headers && Object.keys(config.headers).length > 0) {
        converted.headers = config.headers;
      }
    } else {
      const commandArray = resolveLocalMcpCommand(config);
      const [command, ...args] = commandArray;
      if (!command) {
        warnAndSkipMcpServer({
          toolName: "Muse Code",
          serverName: name,
          reason: "a stdio transport without a command",
          logger,
        });
        continue;
      }
      converted.transport = "stdio";
      converted.command = command;
      converted.args = args;
      if (config.env && Object.keys(config.env).length > 0) {
        converted.env = config.env;
      }
      Object.assign(converted, toMusecodeCwd(config.cwd));
    }
    if (config.disabled === true) {
      converted.enabled = false;
    }
    Object.assign(converted, toMusecodeTimeouts(config));
    // Authored as `musecodeMode` and re-merged from the raw source JSON by
    // `fromRulesyncMcp`, because `getMcpServers()` strips it. Muse Code defaults
    // an absent `mode` to `required`, so an explicit `"required"` is still
    // written when it was authored: dropping it as redundant would silently
    // rewrite the file on the next generate.
    const mode = asMusecodeMode(config.musecodeMode);
    if (mode !== undefined) {
      converted.mode = mode;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Convert Muse Code's native `mcp_servers` shape back to canonical rulesync
 * servers. The `transport` discriminator is dropped (`streamable_http` is not a
 * canonical enum value; the transport is re-derived from `command`/`url` on the
 * next generate), `enabled: false` maps back to `disabled: true`, a documented
 * `mode` is lifted into the authoring key `musecodeMode` so the next generate
 * reproduces it, `tool_timeout_sec` / `startup_timeout_sec` (seconds) become
 * the canonical millisecond `timeout` / `networkTimeout`, and unknown keys
 * (e.g. `framing`, `cwd`) pass through untouched.
 *
 * A `mode` whose value is neither `required` nor `optional` is dropped with a
 * warning rather than either renamed or passed through. Renaming is out because
 * `musecodeMode` is typed as those two values, so an unrecognized one there
 * would produce a `.rulesync/mcp.json` that the next parse rejects — for every
 * server in the file, not just this entry (the `kiroAutoApprove` precedent in
 * `kiro-mcp.ts`). Passing it through is out because `McpServerSchema` is loose:
 * a surviving `mode` reaches `getMcpServers()` and is copied verbatim into every
 * *other* target's config, so a Muse Code key would land everywhere except Muse
 * Code, whose own generate does not emit it. Dropping loses nothing that was not
 * already lost on the next generate, and it matches how this same function
 * already drops `transport` and how the rovodev adapter drops a `transport`
 * outside its vocabulary.
 */
function convertFromMusecodeFormat(musecodeMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(musecodeMcp)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "transport") continue;
      // `musecodeMode` is the rulesync-side spelling that the `mode` branch
      // below lifts into. Muse Code never writes it, so one that turns up in
      // settings.json is noise — and passing it through would put an unchecked
      // value into `.rulesync/mcp.json` under a key typed as exactly two
      // values, failing the next parse of the whole file rather than just this
      // entry.
      if (key === "musecodeMode") continue;
      if (key === "enabled") {
        if (value === false) {
          converted.disabled = true;
        }
        continue;
      }
      if (key === "mode") {
        const mode = asMusecodeMode(value);
        if (mode === undefined) {
          // Serialized rather than interpolated: both halves come off disk, and
          // an unquoted value is what lets a crafted one read as a second line.
          warnWithFallback(
            undefined,
            `Muse Code MCP: dropping mode ${quoteValueForWarning(value)} on server ` +
              `${quoteValueForWarning(name)} because it is neither "required" nor "optional", the ` +
              `only two modes Muse Code documents.`,
          );
          continue;
        }
        converted.musecodeMode = mode;
        continue;
      }
      const canonicalTimeoutKey = Object.hasOwn(MUSECODE_TO_RULESYNC_TIMEOUT_FIELD_MAP, key)
        ? MUSECODE_TO_RULESYNC_TIMEOUT_FIELD_MAP[key]
        : undefined;
      if (canonicalTimeoutKey !== undefined) {
        // Dropped rather than passed through when unusable: a surviving
        // `*_timeout_sec` would be copied verbatim into every other target's
        // config by the loose server schema (the `mode` reasoning above).
        if (isPositiveTimeout(value)) {
          converted[canonicalTimeoutKey] = value * MILLISECONDS_PER_SECOND;
        } else {
          warnWithFallback(
            undefined,
            `Muse Code MCP: dropping ${key} ${quoteValueForWarning(value)} on server ` +
              `${quoteValueForWarning(name)} because it is not a positive number of seconds.`,
          );
        }
        continue;
      }
      converted[key] = value;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Meta Muse Code MCP servers.
 *
 * Muse Code reads MCP servers only from the `mcp_servers` (or `mcpServers`)
 * block of the GLOBAL user settings file `~/.config/muse/settings.json`; no
 * project-scoped MCP location is documented. The settings file must carry
 * `"schema_version": 1` — a file that omits that key fails every command at
 * startup with `malformed settings file` — so the key is bootstrapped when the
 * file is created and preserved when it already exists. Other settings keys are
 * preserved via the shared-config gateway, and the file is never deleted.
 *
 * @see https://dev.meta.ai/docs/muse-code/configuration.md
 * @see https://dev.meta.ai/docs/muse-code/extending.md
 */
export class MusecodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseMusecodeSettings(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // settings.json is the user's primary Muse Code config (schema_version,
    // tool configuration, ...), so it must never be removed wholesale;
    // clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: MUSECODE_GLOBAL_CONFIG_DIR_PATH,
      relativeFilePath: MUSECODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<MusecodeMcp> {
    if (!global) {
      throw new Error(MUSECODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";

    return new MusecodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<MusecodeMcp> {
    if (!global) {
      throw new Error(MUSECODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseMusecodeSettings(existingContent, filePath);

    // `musecodeMode` is stripped by `getMcpServers()` so it cannot leak into
    // other tools' configs, so read it back off the unfiltered source JSON —
    // the same re-merge codex does for `envVars`.
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers()).map(([serverName, serverConfig]) => {
        const rawServer = rulesyncMcp.getRawMcpServer(serverName);
        const mode = asMusecodeMode(isRecord(rawServer) ? rawServer.musecodeMode : undefined);
        return [serverName, { ...serverConfig, ...(mode !== undefined && { musecodeMode: mode }) }];
      }),
    );
    const converted = convertToMusecodeFormat(mcpServers, logger);
    if (hasBothMusecodeServersKeys(existing)) {
      warnWithFallback(logger, BOTH_SERVERS_KEYS_WARNING);
    }

    return new MusecodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          [resolveMusecodeServersKey(existing)]: converted,
          // Bootstrap `schema_version` on file creation (Muse Code rejects a
          // settings.json without it); an existing value is left untouched.
          ...(existing.schema_version === undefined && {
            schema_version: MUSECODE_SETTINGS_SCHEMA_VERSION,
          }),
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    if (hasBothMusecodeServersKeys(this.json)) {
      warnWithFallback(undefined, BOTH_SERVERS_KEYS_WARNING);
    }
    const servers = this.json[resolveMusecodeServersKey(this.json)];
    const mcpServers = isRecord(servers) ? servers : {};
    const converted = convertFromMusecodeFormat(mcpServers);

    // Do not spread the full settings JSON: tool-specific keys (schema_version,
    // tool configuration, ...) must not leak into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: converted }, null, 2),
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
  }: ToolMcpForDeletionParams): MusecodeMcp {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new MusecodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcp_servers: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
