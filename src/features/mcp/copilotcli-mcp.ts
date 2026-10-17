import { join } from "node:path";

import {
  COPILOT_DIR,
  COPILOTCLI_MCP_FILE_NAME,
  COPILOTCLI_PROJECT_MCP_FILE_NAME,
  COPILOTCLI_PROJECT_SETTINGS_DIR_PATH,
  COPILOTCLI_SETTINGS_FILE_NAME,
  GITHUB_DIR,
} from "../../constants/copilot-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, type McpServer, type McpServers } from "../../types/mcp.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject, isStringArray } from "../../utils/type-guards.js";
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
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

type CopilotcliMcpConfig = {
  mcpServers?: Record<string, McpServer & Record<string, unknown>>;
};

type CopilotcliServerType = NonNullable<McpServer["type"]>;

/**
 * Reached over WebSocket, which Copilot CLI has no transport for. The url is
 * read as well as the declared transport: a `wss://` server that names no
 * transport would otherwise be written as `http`, which is the state the
 * declared-`ws` skip exists to avoid.
 */
const isWebSocketServer = (server: McpServer): boolean => {
  if ((server.type ?? server.transport) === "ws") {
    return true;
  }
  // The same resolution the write side uses, so the two cannot disagree about
  // which url is the one going out. Schemes are case-insensitive.
  const url = resolveRemoteMcpUrl(server);
  return url !== undefined && /^wss?:\/\//i.test(url);
};

/**
 * Copilot CLI knows `stdio`, `local`, `http` and `sse`. `streamable-http` is
 * the MCP spec's name for HTTP and resolves to `http` rather than falling
 * through to `stdio`, where it used to be reported as a server missing its
 * command. A server that states no transport is read from what it carries: a
 * command makes it `stdio`, a url makes it `http`.
 */
const resolveCopilotcliServerType = (server: McpServer): CopilotcliServerType => {
  const declared = server.type ?? server.transport;
  switch (declared) {
    case "sse":
      return "sse";
    case "http":
    case "streamable-http":
      return "http";
    case "stdio":
    case "local":
      return declared;
    default:
      break;
  }

  if (server.command !== undefined) {
    return "stdio";
  }
  return isRemoteMcpServer(server) ? "http" : "stdio";
};

/**
 * Copilot CLI's per-server tool allowlist. `tools` selects which of the
 * server's tools are exposed — `["*"]` (the default) for all, or a list of
 * names — so the canonical `enabledTools` is written under that name rather
 * than passed through as a key the CLI ignores.
 *
 * When a server carries both, the canonical `enabledTools` wins and the native
 * `tools` is dropped with a warning. rulesync owns the generated allowlist, and
 * the `tools` value most likely present is the upstream default `["*"]` — left
 * to win, it would silently discard a real allowlist in favour of "expose every
 * tool", which is the failure this mapping exists to prevent. That is the
 * "canonical wins" branch of the collision rule documented on `enabledTools` in
 * `src/types/mcp.ts`; `kiro-mcp.ts` merges instead (its native names are
 * redundant spellings of additive lists) and `codexcli-mcp.ts` refuses instead
 * (Codex's same-named key means a different thing).
 *
 * `disabledTools` has no counterpart upstream (expressing it would need the
 * server's full tool list), so the target keeps `supportsDisabledTools: false`
 * and the processor strips it before it reaches here.
 *
 * @see https://docs.github.com/en/copilot/how-tos/copilot-cli/customize-copilot/add-mcp-servers
 */
function renameEnabledToolsToTools({
  server,
  serverName,
  logger,
}: {
  server: McpServer;
  serverName: string;
  logger?: Logger;
}): Record<string, unknown> {
  const { enabledTools, ...rest } = server;
  if (enabledTools === undefined) {
    return rest;
  }
  if (rest.tools !== undefined) {
    logger?.warn(
      `[CopilotcliMcp] MCP server "${serverName}" declares both 'tools' and 'enabledTools'; keeping 'enabledTools' and dropping 'tools'.`,
    );
  }
  return { ...rest, tools: enabledTools };
}

/**
 * Resolves and sets the transport type for each MCP server config.
 * GitHub Copilot CLI requires the "type" field for each server. A server it
 * cannot express — one that names no transport, or names one it carries no way
 * to reach — is skipped with a warning: every entry in `mcp-config.json`
 * defines a server, and throwing would abort the whole generate run, every
 * target and feature of it, over a single entry.
 */
function addTypeField(mcpServers: McpServers, logger?: Logger): CopilotcliMcpConfig["mcpServers"] {
  const result: NonNullable<CopilotcliMcpConfig["mcpServers"]> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    const parsed = McpServerSchema.parse(server);
    // The shape a Kilo `{"enabled": …}` toggle imports as, which switches off a
    // server some other config layer defines. Copilot CLI has no equivalent.
    if (declaresNoTransport(parsed)) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "no transport at all",
        logger,
      });
      continue;
    }

    // Writing it as `http` would leave a `wss://` url under a transport
    // Copilot CLI speaks HTTP to, so it is skipped the way the Kimi Code
    // adapter skips one over the same missing transport.
    if (isWebSocketServer(parsed)) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "a WebSocket transport, which it does not support",
        logger,
      });
      continue;
    }

    const type = resolveCopilotcliServerType(parsed);

    if (type === "http" || type === "sse") {
      const url = resolveRemoteMcpUrl(parsed);
      if (url === undefined) {
        warnAndSkipMcpServer({
          toolName: "GitHub Copilot CLI",
          serverName: name,
          reason: "a remote transport but no url",
          logger,
        });
        continue;
      }

      // `httpUrl` is a canonical-only alias; Copilot CLI reads `url`, so the
      // resolved value is written there and the alias does not go out.
      // `disabled` does not go out either: Copilot CLI switches a server off
      // through `disabledMcpServers` in its settings file, written by
      // `CopilotcliMcp.getAuxiliaryFiles`.
      const { httpUrl: _httpUrl, disabled: _disabled, ...rest } = parsed;
      result[name] = {
        ...renameEnabledToolsToTools({ server: rest, serverName: name, logger }),
        type,
        url,
      };
      continue;
    }

    // `httpUrl` is a canonical-only alias and does not go out on this branch
    // either, even though a local server has no business carrying one.
    const { httpUrl: _localHttpUrl, disabled: _localDisabled, ...local } = parsed;
    const command = resolveLocalMcpCommand(parsed);
    const [head, ...tail] = command;
    if (head === undefined) {
      warnAndSkipMcpServer({
        toolName: "GitHub Copilot CLI",
        serverName: name,
        reason: "a local transport but no command",
        logger,
      });
      continue;
    }

    result[name] = {
      ...renameEnabledToolsToTools({ server: local, serverName: name, logger }),
      type,
      command: head,
      ...(tail.length > 0 && { args: tail }),
    };
  }

  return result;
}

/**
 * Removes the "type" field when converting back to rulesync format.
 */
function removeTypeField(config: CopilotcliMcpConfig): McpServers {
  const result: McpServers = {};

  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    // `tools` is Copilot CLI's spelling of the canonical `enabledTools`; it is
    // read back so a hand-written allowlist survives an import round-trip. A
    // value the canonical schema cannot hold (e.g. the documented bare `"*"`)
    // stays under `tools` rather than failing validation of the whole file.
    //
    // Copilot CLI's `tools` accepts more than the canonical `enabledTools`
    // shape: `--tools` documents `*`, a comma-separated list, or `""`, so a
    // hand-written or CLI-written entry can be a bare string. Canonical
    // `enabledTools` is `string[]`, and `RulesyncMcp` throws on a schema
    // failure — carrying a string through would reject the WHOLE imported MCP
    // file rather than one key.
    const { tools, ...withoutTools } = server;
    const restored = (
      isStringArray(tools)
        ? { ...withoutTools, enabledTools: tools }
        : { ...withoutTools, ...(tools !== undefined && { tools }) }
    ) as McpServers[string];

    if (restored.type !== "stdio") {
      result[name] = restored;
      continue;
    }

    const { type: _, ...rest } = restored;
    result[name] = rest;
  }

  return result;
}

/**
 * The Copilot CLI settings file carrying `disabledMcpServers`:
 * `.github/copilot/settings.json` (project) / `~/.copilot/settings.json`
 * (global). Both scopes document the key ("MCP server names to disable. Listed
 * servers are configured but not started"); at repository scope it is
 * union-merged with the user value, so a repository can add names but never
 * remove them.
 *
 * @see https://docs.github.com/en/copilot/reference/copilot-cli-reference/cli-config-dir-reference
 */
function copilotCliSettingsPaths({ global }: { global: boolean }): SharedWritePath {
  return global
    ? { relativeDirPath: COPILOT_DIR, relativeFilePath: COPILOTCLI_SETTINGS_FILE_NAME }
    : {
        relativeDirPath: COPILOTCLI_PROJECT_SETTINGS_DIR_PATH,
        relativeFilePath: COPILOTCLI_SETTINGS_FILE_NAME,
      };
}

type CopilotCliSettings = {
  paths: SharedWritePath;
  /** The file as it is on disk, `""` when it does not exist. */
  existingContent: string;
  /** The parsed document; `null` when the file exists but cannot be parsed. */
  document: Record<string, unknown> | null;
  /** The parse failure behind a `null` document. */
  error?: unknown;
};

async function readCopilotCliSettings({
  outputRoot,
  global,
}: {
  outputRoot: string;
  global: boolean;
}): Promise<CopilotCliSettings> {
  const paths = copilotCliSettingsPaths({ global });
  const existingContent =
    (await readFileContentOrNull(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    )) ?? "";
  try {
    const document = parseSharedConfig({
      format: "json",
      fileContent: existingContent,
      filePath: join(paths.relativeDirPath, paths.relativeFilePath),
      invalidRootPolicy: "error",
    });
    return { paths, existingContent, document };
  } catch (error) {
    return { paths, existingContent, document: null, error };
  }
}

/**
 * The names of the servers rulesync actually writes for this target: one
 * `addTypeField` skips (no transport, WebSocket, missing url or command) is
 * not managed, so its name neither gains a toggle nor strips a same-named
 * user-authored entry from the settings file.
 */
function managedServerNames(mcpServers: McpServers): string[] {
  return Object.keys(addTypeField(mcpServers) ?? {});
}

/**
 * Overlays `disabled: true` on the servers the scope's settings file lists in
 * `disabledMcpServers`, so import round-trips the toggle into the canonical
 * config. A settings file that exists but cannot be parsed throws
 * (fail-closed): importing past it would re-enable every disabled server.
 */
async function overlayDisabledServers({
  mcpServers,
  outputRoot,
  global,
}: {
  mcpServers: Record<string, unknown>;
  outputRoot: string;
  global: boolean;
}): Promise<Record<string, unknown>> {
  const settings = await readCopilotCliSettings({ outputRoot, global });
  if (settings.document === null) {
    throw new Error(
      `Cannot import Copilot CLI MCP servers: ${formatError(settings.error)}. ` +
        `Fix the file so disabledMcpServers can be read.`,
      { cause: settings.error },
    );
  }
  const disabled = settings.document.disabledMcpServers;
  if (!isStringArray(disabled) || disabled.length === 0) {
    return mcpServers;
  }
  const servers = { ...mcpServers };
  for (const name of disabled) {
    // Own-property guard: a committed `__proto__` entry must not reach the
    // object's prototype.
    if (!Object.hasOwn(servers, name)) {
      continue;
    }
    const server = servers[name];
    if (isPlainObject(server)) {
      servers[name] = { ...server, disabled: true };
    }
  }
  return servers;
}

/**
 * Auxiliary writer for `disabledMcpServers` in the Copilot CLI settings file.
 * Only that key is owned (through the shared-config gateway), so `deniedUrls`,
 * `disableAllHooks`, `model` and every other setting are preserved. It is a
 * shared, user-owned file and is never deleted.
 */
export class CopilotcliMcpSettings extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
  }
}

export class CopilotcliMcp extends ToolMcp {
  private readonly json: CopilotcliMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): CopilotcliMcpConfig {
    return this.json;
  }

  /**
   * In global mode, ~/.copilot/mcp-config.json should not be deleted
   * as it may contain other user settings.
   * In project mode, .github/mcp.json is a rulesync-managed workspace MCP file
   * and can be safely deleted.
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  /**
   * - **Project scope**: `<project>/.github/mcp.json` — the Copilot CLI
   *   auto-loads MCP servers from this workspace config file. It uses the
   *   standard `{ "mcpServers": {...} }` shape.
   *   https://github.com/github/copilot-cli (changelog v1.0.61, 2026-06-09)
   * - **Global scope**: `~/.copilot/mcp-config.json` — the personal/global
   *   Copilot CLI MCP configuration.
   */
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: COPILOT_DIR,
        relativeFilePath: COPILOTCLI_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: GITHUB_DIR,
      relativeFilePath: COPILOTCLI_PROJECT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = {
      ...json,
      mcpServers: await overlayDisabledServers({
        mcpServers: json.mcpServers ?? {},
        outputRoot,
        global,
      }),
    };

    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = JSON.parse(fileContent);

    // The off-switch for a disabled server lives in the settings file (written
    // by `getAuxiliaryFiles`). When that file exists but cannot be parsed, or
    // its `disabledMcpServers` is not a string array (left untouched), the
    // switch cannot be written — so the disabled server's runnable definition
    // is not written either, or it would simply start (fail-closed).
    const settings = await readCopilotCliSettings({ outputRoot, global });
    const existingDisabled = settings.document?.disabledMcpServers;
    const offSwitchBlocker =
      settings.document === null
        ? "cannot be parsed"
        : existingDisabled !== undefined && !isStringArray(existingDisabled)
          ? "has a disabledMcpServers value that is not an array of server names"
          : undefined;
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers()).filter(([name, server]) => {
        if (server.disabled !== true || offSwitchBlocker === undefined) {
          return true;
        }
        logger?.warn(
          `[CopilotcliMcp] Skipping disabled MCP server "${name}": ` +
            `${join(settings.paths.relativeDirPath, settings.paths.relativeFilePath)} ` +
            `${offSwitchBlocker}, so disabledMcpServers cannot be written to switch it off.`,
        );
        return false;
      }),
    );

    // Convert rulesync format to Copilot CLI format (add "type": "stdio")
    const copilotCliMcpServers = addTypeField(mcpServers, logger);
    const mcpJson = { ...json, mcpServers: copilotCliMcpServers };

    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
      global,
    });
  }

  /**
   * `disabledMcpServers` lives in the Copilot CLI settings file the hooks and
   * permissions features also write. Declared here so the write-order
   * derivation sees this feature as one of that file's writers — it is not a
   * settable path, since the servers themselves live in the MCP file.
   */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    return [copilotCliSettingsPaths({ global })];
  }

  /**
   * Routes the canonical `disabled: true` to `disabledMcpServers`, the key
   * Copilot CLI actually consults: an MCP file entry has no `disabled` field.
   * rulesync owns the toggle for the servers it writes; names it does not
   * manage keep their existing state. The file is not created or touched when
   * there is nothing to disable and nothing to retract, nor when the existing
   * `disabledMcpServers` is not a string array (left as is, with a warning).
   */
  static override async getAuxiliaryFiles({
    outputRoot = process.cwd(),
    global = false,
    rulesyncMcp,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    rulesyncMcp: RulesyncMcp;
    logger?: Logger;
  }): Promise<ToolFile[]> {
    const servers = rulesyncMcp.forTarget({ toolTarget: "copilotcli", global }).getMcpServers();
    const managedNames = managedServerNames(servers);
    const disabledNames = managedNames.filter((name) => servers[name]?.disabled === true);

    const settings = await readCopilotCliSettings({ outputRoot, global });
    if (settings.document === null) {
      // Skip only this file: the servers themselves must still be written.
      // `fromRulesyncMcp` already left the disabled ones out.
      logger?.warn(
        `Skipping the Copilot CLI disabledMcpServers update: ${formatError(settings.error)}`,
      );
      return [];
    }

    const existing = settings.document.disabledMcpServers;
    if (existing !== undefined && !isStringArray(existing)) {
      // Rewriting it would silently drop whatever the user put there, so the
      // value is left as it is and the toggle is not updated this run.
      logger?.warn(
        `Skipping the Copilot CLI disabledMcpServers update: the existing value is not an array ` +
          `of server names. Fix it in ${join(settings.paths.relativeDirPath, settings.paths.relativeFilePath)} ` +
          `so rulesync can manage the toggle.`,
      );
      return [];
    }
    const existingDisabled = existing ?? [];
    const managedNameSet = new Set(managedNames);
    // Removal flips an off-switch, so a managed name that is disabled on disk
    // but enabled canonically is called out rather than silently re-enabled.
    const reEnabled = existingDisabled.filter(
      (name) => managedNameSet.has(name) && !disabledNames.includes(name),
    );
    if (reEnabled.length > 0) {
      logger?.warn(
        `Copilot CLI MCP: re-enabling ${reEnabled.join(", ")} — the canonical config does not mark ` +
          `${reEnabled.length === 1 ? "it" : "them"} disabled. Set "disabled": true in ` +
          `.rulesync/mcp.jsonc to keep a managed server off.`,
      );
    }
    const mergedDisabled = [
      ...existingDisabled.filter((name) => !managedNameSet.has(name)),
      ...disabledNames,
    ].toSorted();

    if (mergedDisabled.length === 0 && existing === undefined) {
      return [];
    }
    if (
      isStringArray(existing) &&
      existing.length === mergedDisabled.length &&
      existing.toSorted().every((name, index) => name === mergedDisabled[index])
    ) {
      return [];
    }

    const { paths } = settings;
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    return [
      new CopilotcliMcpSettings({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: applySharedConfigPatch({
          fileKey: sharedConfigFileKey(paths),
          feature: "mcp",
          existingContent: settings.existingContent,
          patch: { disabledMcpServers: mergedDisabled.length > 0 ? mergedDisabled : undefined },
          filePath,
        }),
        global,
      }),
    ];
  }

  toRulesyncMcp(): RulesyncMcp {
    // Convert Copilot CLI format back to rulesync format (remove "type" field)
    const mcpServers = removeTypeField(this.json);
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
  }: ToolMcpForDeletionParams): CopilotcliMcp {
    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
