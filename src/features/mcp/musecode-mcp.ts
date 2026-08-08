import { join } from "node:path";

import {
  MUSECODE_GLOBAL_CONFIG_DIR_PATH,
  MUSECODE_SETTINGS_FILE_NAME,
  MUSECODE_SETTINGS_SCHEMA_VERSION,
} from "../../constants/musecode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
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
 * Convert canonical rulesync servers to Muse Code's native `mcp_servers` shape.
 * Each entry carries a `transport` discriminator: `stdio` servers spawn a
 * `command` (single string) with `args`/`env`, and `streamable_http` servers
 * are reached at a `url` with optional `headers`. Only documented fields are
 * emitted; a canonical `disabled: true` maps to Muse's `enabled: false`.
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
    }
    if (config.disabled === true) {
      converted.enabled = false;
    }

    result[name] = converted;
  }

  return result;
}

/**
 * Convert Muse Code's native `mcp_servers` shape back to canonical rulesync
 * servers. The `transport` discriminator is dropped (`streamable_http` is not a
 * canonical enum value; the transport is re-derived from `command`/`url` on the
 * next generate), `enabled: false` maps back to `disabled: true`, and unknown
 * keys (e.g. `mode`, `framing`) pass through untouched.
 */
function convertFromMusecodeFormat(musecodeMcp: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(musecodeMcp)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const converted: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (key === "transport") continue;
      if (key === "enabled") {
        if (value === false) {
          converted.disabled = true;
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
 * Muse Code reads MCP servers only from the `mcp_servers` block of the GLOBAL
 * user settings file `~/.config/muse/settings.json`; no project-scoped MCP
 * location is documented. The settings file must carry
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

    const converted = convertToMusecodeFormat(rulesyncMcp.getMcpServers(), logger);

    return new MusecodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        patch: {
          mcp_servers: converted,
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
    const mcpServers = isRecord(this.json.mcp_servers) ? this.json.mcp_servers : {};
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
