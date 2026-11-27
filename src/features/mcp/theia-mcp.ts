import { join } from "node:path";

import {
  THEIA_DIR,
  THEIA_MCP_SERVERS_KEY,
  THEIA_SETTINGS_FILE_NAME,
} from "../../constants/theia-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers, McpServerSchema } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfigFile,
  sharedConfigFileKey,
  undefinedWhenEmpty,
} from "../shared/shared-config-gateway.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  McpServerConfig,
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

const TOOL_NAME = "Theia AI";

/**
 * The keys of the canonical server schema. Theia reads `command`, `args`,
 * `env`, `url` (as `serverUrl`) and `headers` of them, so the rest are
 * dropped; a key NOT on this list is unknown to rulesync and passed through
 * untouched, so a Theia-native field such as `autostart`, `deferLoading`,
 * `oauth`, `serverAuthToken` or `serverAuthTokenHeader` written on the server
 * (or in the tool-scoped `theia.mcpServers` block) reaches the settings file.
 */
const CANONICAL_MCP_SERVER_KEYS = new Set(Object.keys(McpServerSchema.def.shape));

/**
 * The server keys Theia documents for users to configure. Rulesync owns these
 * on every server it writes: a key the rulesync source no longer states is
 * removed. Any other key of an existing entry — the `registryMetadata` block
 * Theia's AI registry writes, or a key a newer Theia adds — is kept.
 *
 * @see https://github.com/eclipse-theia/theia/blob/master/packages/ai-mcp/src/common/mcp-preferences.ts
 */
const THEIA_CONFIGURABLE_SERVER_KEYS = new Set([
  "command",
  "args",
  "env",
  "autostart",
  "deferLoading",
  "serverUrl",
  "serverAuthToken",
  "serverAuthTokenHeader",
  "headers",
  "oauth",
]);

/** Theia-managed provenance that does not belong in a rulesync source. */
const THEIA_IMPORT_DROPPED_KEYS = new Set(["registryMetadata"]);

function passthroughNonCanonicalFields(serverConfig: McpServerConfig): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(serverConfig).filter(
      ([key]) => !CANONICAL_MCP_SERVER_KEYS.has(key) && !isPrototypePollutionKey(key),
    ),
  );
}

/**
 * Translate one canonical server into a Theia `ai-features.mcp.mcpServers`
 * entry, or return `null` (with a warning) for a server Theia cannot express.
 * A local server is `{ command, args?, env? }`, a remote one
 * `{ serverUrl, headers? }`; Theia has no `type` field and no per-server
 * disable switch (`autostart: false` only skips the automatic start).
 *
 * @see https://theia-ide.org/docs/user_ai/#mcp-integration
 */
function convertServerToTheiaFormat({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: McpServerConfig;
  logger?: Logger;
}): Record<string, unknown> | null {
  if (serverConfig.disabled === true) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName,
      reason: "`disabled: true`, and Theia AI has no per-server disable switch",
      logger,
    });
  }
  if (declaresNoTransport(serverConfig)) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName,
      reason: "no command or url",
      logger,
    });
  }

  const passthrough = passthroughNonCanonicalFields(serverConfig);

  if (isRemoteMcpServer(serverConfig)) {
    const url = resolveRemoteMcpUrl(serverConfig);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: TOOL_NAME,
        serverName,
        reason: "a remote transport but no url",
        logger,
      });
    }
    return {
      ...passthrough,
      serverUrl: url,
      ...(serverConfig.headers !== undefined && { headers: serverConfig.headers }),
    };
  }

  const [command, ...args] = resolveLocalMcpCommand(serverConfig);
  if (command === undefined) {
    return warnAndSkipMcpServer({
      toolName: TOOL_NAME,
      serverName,
      reason: "a local transport but no command",
      logger,
    });
  }
  return {
    ...passthrough,
    command,
    ...(args.length > 0 && { args }),
    ...(serverConfig.env !== undefined && { env: serverConfig.env }),
  };
}

/**
 * The keys of an existing entry that survive regeneration: everything Theia
 * does not document as user configuration (see
 * {@link THEIA_CONFIGURABLE_SERVER_KEYS}) and the generated entry does not set.
 */
function preservedExistingFields({
  existing,
  generated,
}: {
  existing: unknown;
  generated: Record<string, unknown>;
}): Record<string, unknown> {
  if (!isRecord(existing)) return {};
  return Object.fromEntries(
    Object.entries(existing).filter(
      ([key]) =>
        !THEIA_CONFIGURABLE_SERVER_KEYS.has(key) &&
        !Object.hasOwn(generated, key) &&
        !isPrototypePollutionKey(key),
    ),
  );
}

/**
 * The Theia server keys that map onto the canonical server schema. A server
 * carrying any other key (`serverAuthToken`, `oauth`, `autostart`, ...) is
 * Theia-specific: some of those keys hold credentials, and none of them means
 * anything to another tool.
 */
const THEIA_SHARED_SERVER_KEYS = new Set(["command", "args", "env", "serverUrl", "headers"]);

/** Translate one Theia entry back into a canonical server. */
function convertServerFromTheiaFormat(server: Record<string, unknown>): {
  canonical: Record<string, unknown>;
  theiaOnly: boolean;
} {
  const canonical: Record<string, unknown> = {};
  let theiaOnly = false;
  for (const [key, value] of Object.entries(server)) {
    if (THEIA_IMPORT_DROPPED_KEYS.has(key) || isPrototypePollutionKey(key)) continue;
    if (!THEIA_SHARED_SERVER_KEYS.has(key)) theiaOnly = true;
    canonical[key === "serverUrl" ? "url" : key] = value;
  }
  return { canonical, theiaOnly };
}

/**
 * MCP generator for Eclipse Theia AI.
 *
 * Theia reads MCP servers from the `ai-features.mcp.mcpServers` preference.
 * Workspace preferences live in `.theia/settings.json` beside every other
 * workspace preference, so only that key is written (the file is merged in
 * place, comments included, and never deleted). Generated servers replace the
 * map; on a server that already exists, keys Theia does not document as user
 * configuration (such as its AI registry's `registryMetadata`) are kept.
 *
 * Theia ignores workspace AI preferences in an untrusted workspace. The user
 * settings path differs per Theia-based product and is not documented, so only
 * the project scope is supported.
 *
 * @see https://theia-ide.org/docs/user_ai/#mcp-integration
 */
export class TheiaMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseSharedConfigFile({
      fileKey: sharedConfigFileKey(TheiaMcp.getSettablePaths()),
      fileContent: this.fileContent || "{}",
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      throw new Error("TheiaMcp does not support global mode.");
    }
    return {
      relativeDirPath: THEIA_DIR,
      relativeFilePath: THEIA_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<TheiaMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "{}";

    return new TheiaMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<TheiaMcp> {
    const paths = this.getSettablePaths({ global });
    const fileKey = sharedConfigFileKey(paths);
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const existing = parseSharedConfigFile({ fileKey, fileContent: existingContent, filePath });
    const existingServers = isRecord(existing[THEIA_MCP_SERVERS_KEY])
      ? existing[THEIA_MCP_SERVERS_KEY]
      : {};

    const mcpServers: Record<string, Record<string, unknown>> = {};
    for (const [serverName, serverConfig] of Object.entries(rulesyncMcp.getMcpServers())) {
      if (isPrototypePollutionKey(serverName)) continue;
      const converted = convertServerToTheiaFormat({ serverName, serverConfig, logger });
      if (converted === null) continue;
      mcpServers[serverName] = {
        ...preservedExistingFields({
          existing: Object.hasOwn(existingServers, serverName)
            ? existingServers[serverName]
            : undefined,
          generated: converted,
        }),
        ...converted,
      };
    }

    return new TheiaMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey,
        feature: "mcp",
        existingContent,
        // With no server left the key is retracted rather than left as an
        // empty object in the shared settings file.
        patch: { [THEIA_MCP_SERVERS_KEY]: undefinedWhenEmpty(mcpServers) },
        filePath,
        logger,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = this.json[THEIA_MCP_SERVERS_KEY];
    const mcpServers: McpServers = {};
    const theiaServers: McpServers = {};
    if (isRecord(servers)) {
      for (const [serverName, server] of Object.entries(servers)) {
        // A hand-written file can hold a null or array entry, which is no
        // server at all.
        if (isPrototypePollutionKey(serverName) || !isRecord(server)) continue;
        const { canonical, theiaOnly } = convertServerFromTheiaFormat(server);
        // A server with Theia-specific keys goes into the tool-scoped
        // `theia.mcpServers` block, which replaces a same-named shared server
        // for Theia only, so a `serverAuthToken` never reaches another tool.
        (theiaOnly ? theiaServers : mcpServers)[serverName] = canonical;
      }
    }
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers,
          ...(Object.keys(theiaServers).length > 0 && { theia: { mcpServers: theiaServers } }),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * `.theia/settings.json` holds every Theia workspace preference, so it must
   * not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): TheiaMcp {
    // SAFETY: `isDeletable()` returns false, so the orchestrator never writes
    // this `{}` content to disk.
    return new TheiaMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
