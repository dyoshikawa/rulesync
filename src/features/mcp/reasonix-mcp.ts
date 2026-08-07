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
// `startup_timeout_seconds` (per-server cap on the background
// launch/authorization/`initialize`/`tools/list` sequence, overriding the global
// `mcp_startup_timeout_seconds`; `0` means fall back to that global cap),
// `call_timeout_seconds` (per-server MCP call timeout) and `tool_timeout_seconds`
// (a per-tool inline table keyed by raw MCP tool name) are likewise Reasonix-only
// `[[plugins]]` fields with no canonical equivalent, so they round-trip as
// passthrough fields too.
// @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
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
] as const;

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

  for (const field of REASONIX_PLUGIN_FIELDS) {
    if (field === "type" || field === "command" || field === "args") {
      continue;
    }
    if (serverRecord[field] !== undefined) {
      plugin[field] = serverRecord[field];
    }
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
    if (field === "type") {
      continue;
    }
    if (plugin[field] !== undefined) {
      result[field] = plugin[field];
    }
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
