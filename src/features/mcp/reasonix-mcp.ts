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

// Reasonix declares an external stdio/http plugin (MCP server) as a `[[plugins]]`
// array-of-tables entry. `type` selects the transport (`stdio` default, `http`
// a.k.a. `streamable-http`); the remaining fields mirror the standard MCP schema.
// `trusted_read_only_tools` is read but never written: v1.17.18 retired it along
// with `default_tools_approval_mode`, `tools.<raw>.approval_mode` and
// `approvals_reviewer` — installing a server is now the authorization decision,
// and Reasonix strips the key the next time it saves that entry. Importing it
// keeps an older file's intent visible in the canonical config (a loose zod
// object, so unknown keys survive), mirroring how other MCP adapters
// preserve server-specific extra fields they don't deeply model.
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
  "call_timeout_seconds",
  "tool_timeout_seconds",
] as const;

/**
 * Fields an older `reasonix.toml` may still carry that Reasonix no longer reads.
 * Imported so the intent stays visible in the canonical config, never written
 * back — Reasonix strips them itself on its next save, and re-emitting one only
 * makes the two writers churn against each other.
 */
const REASONIX_RETIRED_PLUGIN_FIELDS = ["trusted_read_only_tools"] as const;

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
  }: ToolMcpFromRulesyncMcpParams): Promise<ReasonixMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    const plugins = Object.entries(rulesyncMcp.getMcpServers()).map(([name, server]) =>
      rulesyncMcpServerToReasonix(name, server),
    );

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

function rulesyncMcpServerToReasonix(name: string, server: McpServer): ReasonixPlugin {
  const serverRecord = server as Record<string, unknown>;
  const type = resolveReasonixType(server);
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

  for (const field of [...REASONIX_PLUGIN_FIELDS, ...REASONIX_RETIRED_PLUGIN_FIELDS]) {
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
  if (server.url || server.httpUrl) {
    return "http";
  }
  return undefined;
}
