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
const REASONIX_PLUGIN_FIELDS = ["type", "command", "args", "env", "url", "headers"] as const;

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
    const existingContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const config = parseReasonixConfig(existingContent);

    config.plugins = Object.entries(rulesyncMcp.getMcpServers()).map(([name, server]) =>
      rulesyncMcpServerToReasonix(name, server),
    );

    return new ReasonixMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(config),
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
  // Reasonix transports: `stdio` (default), `http` (a.k.a. `streamable-http`).
  // `sse` is deprecated upstream, so collapse it onto `http`; `local` is the
  // rulesync alias for `stdio`.
  const candidate = server.type ?? server.transport;
  if (candidate) {
    if (candidate === "sse" || candidate === "streamable-http") {
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
