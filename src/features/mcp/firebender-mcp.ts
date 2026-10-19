import { join } from "node:path";

import {
  FIREBENDER_CONFIG_FILE_NAME,
  getFirebenderConfigDir,
} from "../../constants/firebender-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, McpServers, McpServerSchema } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
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

/**
 * The keys of the canonical server schema. Firebender reads only `command`,
 * `args`, `env`, `url` and `headers` of them, so the rest are dropped; a key
 * NOT on this list is unknown to rulesync and passed through untouched, so a
 * Firebender-native field such as `deferLoading` written in the tool-scoped
 * `firebender.mcpServers` block (or on a shared server) survives.
 */
const CANONICAL_MCP_SERVER_KEYS = new Set(Object.keys(McpServerSchema.def.shape));

function passthroughNonCanonicalFields(serverConfig: McpServerConfig): Record<string, unknown> {
  return Object.fromEntries(
    Object.entries(serverConfig).filter(([key]) => !CANONICAL_MCP_SERVER_KEYS.has(key)),
  );
}

/**
 * Translate one canonical server into Firebender's `mcpServers` entry, or
 * return `null` (with a warning) for a server Firebender cannot express. A
 * stdio server is `{ command, args?, env? }`, a remote one `{ url, headers? }`;
 * Firebender has no `type` field and no per-server disable switch.
 *
 * @see https://docs.firebender.com/api-reference/syntax
 */
function convertServerToFirebenderFormat({
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
      toolName: "Firebender",
      serverName,
      reason: "`disabled: true`, and Firebender has no per-server disable switch",
      logger,
    });
  }
  if (declaresNoTransport(serverConfig)) {
    return warnAndSkipMcpServer({
      toolName: "Firebender",
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
        toolName: "Firebender",
        serverName,
        reason: "a remote transport but no url",
        logger,
      });
    }
    return {
      ...passthrough,
      url,
      ...(serverConfig.headers !== undefined && { headers: serverConfig.headers }),
    };
  }

  const [command, ...args] = resolveLocalMcpCommand(serverConfig);
  if (command === undefined) {
    return warnAndSkipMcpServer({
      toolName: "Firebender",
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
 * MCP generator for Firebender.
 *
 * Firebender reads MCP servers from the `mcpServers` key of `firebender.json`
 * (project root) and `~/.firebender/firebender.json` (personal; it wins on
 * name clashes). The file is shared with the ignore (`ignore`) and subagents
 * (`agents`) features and carries settings rulesync does not own, so only the
 * `mcpServers` key is written and the file is never deleted.
 *
 * @see https://docs.firebender.com/api-reference/syntax
 */
export class FirebenderMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseSharedConfig({ format: "json", fileContent: this.fileContent || "{}" });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: getFirebenderConfigDir({ global }),
      relativeFilePath: FIREBENDER_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<FirebenderMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "{}";

    return new FirebenderMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<FirebenderMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    const mcpServers: Record<string, unknown> = {};
    for (const [serverName, serverConfig] of Object.entries(rulesyncMcp.getMcpServers())) {
      const converted = convertServerToFirebenderFormat({ serverName, serverConfig, logger });
      if (converted !== null) {
        mcpServers[serverName] = converted;
      }
    }

    return new FirebenderMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "mcp",
        existingContent,
        // With no server left the key is retracted rather than left as an
        // empty object in the shared config file.
        patch: { mcpServers: Object.keys(mcpServers).length > 0 ? mcpServers : undefined },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const servers = this.json.mcpServers;
    const mcpServers: McpServers = {};
    if (isMcpServers(servers)) {
      for (const [serverName, server] of Object.entries(servers)) {
        // `isMcpServers` only guards the outer map; a hand-written file can
        // still hold a null or array entry, which is no server at all.
        if (server !== null && typeof server === "object" && !Array.isArray(server)) {
          mcpServers[serverName] = server;
        }
      }
    }
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * `firebender.json` is a user-managed file shared with other features (the
   * ignore feature's `ignore`, the subagents feature's `agents`), so it must
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
  }: ToolMcpForDeletionParams): FirebenderMcp {
    return new FirebenderMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
