import { join } from "node:path";

import { GITLABDUO_DIR, GITLABDUO_MCP_FILE_NAME } from "../../constants/gitlabduo-paths.js";
import type { McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  type McpServerConfig,
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

type GitlabduoTransport = "stdio" | "http" | "sse";

const CANONICAL_TO_GITLABDUO_TRANSPORT: Record<string, GitlabduoTransport | undefined> = {
  local: "stdio",
  stdio: "stdio",
  http: "http",
  "streamable-http": "http",
  sse: "sse",
};

/**
 * Map the canonical `timeout` (milliseconds) onto GitLab Duo's `timeoutMs`, a
 * per-server tool-call inactivity timeout (gitlab-lsp v9.25.0+) that must be a
 * positive integer. An explicit `timeoutMs` on the same server wins; a
 * `timeout` Duo would reject is dropped with a warning.
 *
 * @see https://gitlab.com/gitlab-org/editor-extensions/gitlab-lsp/-/commit/e8c4a76a66e8f37d4c97fc03ffe983bfadf43f76
 */
function toGitlabduoTimeout({
  serverName,
  server,
  logger,
}: {
  serverName: string;
  server: Record<string, unknown>;
  logger?: Logger;
}): Record<string, unknown> {
  const { timeout, ...rest } = server;
  if (timeout === undefined || rest.timeoutMs !== undefined) {
    return rest;
  }
  if (typeof timeout !== "number" || !Number.isInteger(timeout) || timeout <= 0) {
    logger?.warn(
      `GitLab Duo CLI MCP server "${serverName}": dropping timeout ${JSON.stringify(timeout)}, as timeoutMs must be a positive integer of milliseconds.`,
    );
    return rest;
  }
  return { ...rest, timeoutMs: timeout };
}

/**
 * Read GitLab Duo's `timeoutMs` back into the canonical `timeout`
 * (milliseconds). A server that already carries a `timeout` is left as is, so
 * both keys round-trip and `timeoutMs` keeps winning on the next generate. A
 * non-number `timeoutMs` is not copied, since the canonical `timeout` must be a
 * number; it is kept verbatim as a passthrough key instead.
 */
function fromGitlabduoTimeout(server: unknown): unknown {
  if (typeof server !== "object" || server === null || Array.isArray(server)) {
    return server;
  }
  const { timeoutMs, ...rest } = server as Record<string, unknown>;
  if (typeof timeoutMs !== "number" || rest.timeout !== undefined) {
    return server;
  }
  return { ...rest, timeout: timeoutMs };
}

/**
 * Convert one canonical server into GitLab Duo's shape. Every documented
 * example spells the transport out as `type` (`stdio`, `http` or `sse`), so it
 * is always written, inferred from `command` / `url` when the source leaves it
 * implicit. The canonical `timeout` becomes `timeoutMs`; every other field —
 * `args`, `env`, `approvedTools`, ... — is carried through as authored.
 */
function toGitlabduoServer({
  serverName,
  serverConfig,
  logger,
}: {
  serverName: string;
  serverConfig: McpServerConfig;
  logger?: Logger;
}): Record<string, unknown> | null {
  if (declaresNoTransport(serverConfig)) {
    return warnAndSkipMcpServer({
      toolName: "GitLab Duo CLI",
      serverName,
      reason: "no command or url",
      logger,
    });
  }

  const { type, transport, httpUrl: _httpUrl, url: _url, ...others } = serverConfig;
  const declared = type ?? transport;
  const mapped = declared
    ? CANONICAL_TO_GITLABDUO_TRANSPORT[declared]
    : isRemoteMcpServer(serverConfig)
      ? "http"
      : "stdio";
  if (!mapped) {
    return warnAndSkipMcpServer({
      toolName: "GitLab Duo CLI",
      serverName,
      reason: `the unsupported transport "${declared}" (GitLab Duo CLI accepts stdio, http and sse)`,
      logger,
    });
  }

  const rest = toGitlabduoTimeout({ serverName, server: others, logger });
  if (mapped === "stdio") {
    const { command, args } = serverConfig;
    // GitLab Duo takes `command` as a single executable, so an array-form
    // command is split into the executable and leading arguments.
    if (Array.isArray(command)) {
      const [executable, ...leadingArgs] = command;
      return {
        type: mapped,
        ...rest,
        command: executable,
        args: [...leadingArgs, ...(args ?? [])],
      };
    }
    return { type: mapped, ...rest };
  }

  const url = resolveRemoteMcpUrl(serverConfig);
  if (!url) {
    return warnAndSkipMcpServer({
      toolName: "GitLab Duo CLI",
      serverName,
      reason: `the ${mapped} transport with no url`,
      logger,
    });
  }
  return { type: mapped, url, ...rest };
}

function toGitlabduoServers(servers: McpServers, logger?: Logger): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [serverName, serverConfig] of Object.entries(servers)) {
    const converted = toGitlabduoServer({ serverName, serverConfig, logger });
    if (converted) {
      result[serverName] = converted;
    }
  }
  return result;
}

/**
 * GitLab Duo CLI reads MCP servers from `.gitlab/duo/mcp.json` in the
 * workspace and `~/.gitlab/duo/mcp.json` for the user, both in the
 * `{ "mcpServers": { ... } }` shape. The GitLab-specific `approvedTools`
 * (`true` or a list of tool names) is passed through untouched; put it in a
 * `gitlabduo.mcpServers` block to keep it out of other tools' configs.
 *
 * @see https://docs.gitlab.com/user/gitlab_duo/model_context_protocol/mcp_clients/
 */
export class GitlabduoMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // The same relative path is used under the project root and the home directory.
    return {
      relativeDirPath: GITLABDUO_DIR,
      relativeFilePath: GITLABDUO_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<GitlabduoMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new GitlabduoMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): GitlabduoMcp {
    const paths = this.getSettablePaths({ global });
    const fileContent = JSON.stringify(
      { mcpServers: toGitlabduoServers(rulesyncMcp.getMcpServers(), logger) },
      null,
      2,
    );

    return new GitlabduoMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const { mcpServers, ...others } = this.json;
    if (typeof mcpServers !== "object" || mcpServers === null || Array.isArray(mcpServers)) {
      return this.toRulesyncMcpDefault();
    }
    const servers = Object.fromEntries(
      Object.entries(mcpServers).map(([name, server]) => [name, fromGitlabduoTimeout(server)]),
    );
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ ...others, mcpServers: servers }),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): GitlabduoMcp {
    return new GitlabduoMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
