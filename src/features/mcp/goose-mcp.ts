import { join } from "node:path";

import { dump, load } from "js-yaml";

import {
  GOOSE_GLOBAL_DIR,
  GOOSE_MCP_FILE_NAME,
  GOOSE_PLUGIN_MCP_DIR_PATH,
  GOOSE_PLUGIN_MCP_FILE_NAME,
} from "../../constants/goose-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { warnWithFallback } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const GOOSE_PLUGIN_MCP_RELATIVE_PATH = join(GOOSE_PLUGIN_MCP_DIR_PATH, GOOSE_PLUGIN_MCP_FILE_NAME);

function parseGooseConfig(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = load(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Goose config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // An empty config.yaml parses to undefined/null; treat it as an empty object.
  if (parsed === undefined || parsed === null) {
    return {};
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; a YAML mapping always parses to a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Goose config at ${configPath}: expected a YAML mapping`);
  }
  return parsed;
}

/**
 * Resolves the rulesync canonical transport for a server (`type` or `transport`).
 */
function canonicalTransport(config: Record<string, unknown>): string | undefined {
  if (typeof config.type === "string") return config.type;
  if (typeof config.transport === "string") return config.transport;
  return undefined;
}

/**
 * Resolves the canonical remote URL for a server (`url` or the `httpUrl` alias).
 */
function resolveGooseUrl(config: Record<string, unknown>): string | undefined {
  return (
    (typeof config.url === "string" ? config.url : undefined) ??
    (typeof config.httpUrl === "string" ? config.httpUrl : undefined)
  );
}

/**
 * Determines the Goose `type` for a server based on its command/url/transport.
 */
function resolveGooseType(config: Record<string, unknown>, url: string | undefined): string {
  if (config.command !== undefined) {
    return "stdio";
  }
  if (url !== undefined) {
    return canonicalTransport(config) === "sse" ? "sse" : "streamable_http";
  }
  return canonicalTransport(config) === "builtin" ? "builtin" : "stdio";
}

/**
 * Resolves the canonical timeout for a server (`timeout` or `networkTimeout`).
 */
function resolveGooseTimeout(config: Record<string, unknown>): number | undefined {
  if (typeof config.timeout === "number") return config.timeout;
  if (typeof config.networkTimeout === "number") return config.networkTimeout;
  return undefined;
}

/**
 * Populates the stdio-specific fields (`cmd`, `args`, `envs`) on a Goose ext.
 */
function applyGooseStdioFields(
  ext: Record<string, unknown>,
  config: Record<string, unknown>,
): void {
  const command = config.command;
  // `command` may be a string or an array; Goose `cmd` is a single
  // executable, so an array's tail is folded into `args`.
  if (Array.isArray(command)) {
    if (typeof command[0] === "string") ext.cmd = command[0];
    const rest = command.slice(1).filter((c): c is string => typeof c === "string");
    const args = isStringArray(config.args) ? config.args : [];
    if (rest.length > 0 || args.length > 0) ext.args = [...rest, ...args];
  } else if (typeof command === "string") {
    ext.cmd = command;
    if (isStringArray(config.args)) ext.args = config.args;
  }
  if (isPlainObject(config.env)) ext.envs = omitPrototypePollutionKeys(config.env);
}

/**
 * Converts a single rulesync canonical MCP server into a Goose `extensions:` entry.
 */
function convertServerToGooseExtension(
  name: string,
  config: Record<string, unknown>,
): Record<string, unknown> {
  const url = resolveGooseUrl(config);
  const gooseType = resolveGooseType(config, url);

  const ext: Record<string, unknown> = { name, type: gooseType };

  if (gooseType === "stdio") {
    applyGooseStdioFields(ext, config);
  } else if (gooseType === "sse" || gooseType === "streamable_http") {
    if (url !== undefined) ext.uri = url;
    if (isPlainObject(config.headers)) ext.headers = omitPrototypePollutionKeys(config.headers);
  }

  ext.enabled = config.disabled !== true;

  const timeout = resolveGooseTimeout(config);
  if (timeout !== undefined) ext.timeout = timeout;

  return ext;
}

/**
 * Converts rulesync canonical MCP servers into Goose `extensions:` entries.
 *
 * Goose uses a non-standard schema: `name`, `type` (`stdio` | `streamable_http`
 * | `sse` | `builtin`), `cmd`/`args`/`envs` for stdio, `uri`/`headers` for
 * remote, plus `enabled` and `timeout`.
 */
function convertToGooseFormat(mcpServers: McpServers): Record<string, Record<string, unknown>> {
  const extensions: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    extensions[name] = convertServerToGooseExtension(name, config);
  }

  return extensions;
}

/**
 * Converts Goose `extensions:` entries back into rulesync canonical MCP servers.
 *
 * Goose's schema is a lossy projection of the canonical model, so import
 * normalizes rather than perfectly round-trips: Goose has a single `uri` field,
 * so both `url` and the Claude-specific `httpUrl` alias come back as `url`; and
 * the `streamable_http` type maps back to canonical `http`. These are the
 * canonical/preferred forms, so re-generating produces an equivalent config.
 */
function convertFromGooseFormat(extensions: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, ext] of Object.entries(extensions)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(ext)) continue;

    const server: Record<string, unknown> = {};
    const type = typeof ext.type === "string" ? ext.type : undefined;
    if (type === "sse") {
      server.type = "sse";
    } else if (type === "streamable_http") {
      server.type = "http";
    } else if (type === "stdio") {
      server.type = "stdio";
    }
    // `builtin` has no rulesync canonical equivalent, so its type is dropped.

    if (typeof ext.cmd === "string") server.command = ext.cmd;
    if (isStringArray(ext.args)) server.args = ext.args;
    if (isPlainObject(ext.envs)) server.env = omitPrototypePollutionKeys(ext.envs);
    if (typeof ext.uri === "string") server.url = ext.uri;
    if (isPlainObject(ext.headers)) server.headers = omitPrototypePollutionKeys(ext.headers);
    if (ext.enabled === false) server.disabled = true;
    if (typeof ext.timeout === "number") server.timeout = ext.timeout;

    result[name] = server;
  }

  return result;
}

/**
 * Builds a Claude-style stdio server entry (`command`/`args`/`env`/`cwd`) for the
 * open-plugins `.mcp.json` manifest.
 */
function buildGoosePluginStdioServer(config: Record<string, unknown>): Record<string, unknown> {
  const server: Record<string, unknown> = {};

  const command = config.command;
  // `command` may be a string or an array; the Claude-style manifest uses a
  // single `command` plus an `args` array, so an array's tail folds into `args`.
  if (Array.isArray(command)) {
    if (typeof command[0] === "string") server.command = command[0];
    const rest = command.slice(1).filter((c): c is string => typeof c === "string");
    const args = isStringArray(config.args) ? config.args : [];
    if (rest.length > 0 || args.length > 0) server.args = [...rest, ...args];
  } else if (typeof command === "string") {
    server.command = command;
    if (isStringArray(config.args)) server.args = config.args;
  }

  if (isPlainObject(config.env)) server.env = omitPrototypePollutionKeys(config.env);
  if (typeof config.cwd === "string") server.cwd = config.cwd;

  return server;
}

/**
 * Converts rulesync canonical MCP servers into the Claude-style `mcpServers` map
 * used by Goose open-plugin manifests (`.agents/plugins/rulesync/.mcp.json`).
 *
 * The open-plugins manifest is **stdio-only** (no `url`/`headers`), so remote
 * (http/sse/streamable_http) and `builtin` servers cannot be represented. They
 * are skipped with a warning rather than silently dropped — remote servers stay
 * global-config-only (sync them with `--global` to `~/.config/goose/config.yaml`).
 */
function convertToGoosePluginMcpServers(
  mcpServers: McpServers,
  logger: Logger | undefined,
): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const url = resolveGooseUrl(config);
    const gooseType = resolveGooseType(config, url);
    if (gooseType !== "stdio") {
      warnWithFallback(
        logger,
        `Goose open-plugin MCP manifest (${GOOSE_PLUGIN_MCP_RELATIVE_PATH}) is stdio-only; ` +
          `skipping "${name}" (${gooseType}). Sync it with --global to ~/.config/goose/config.yaml instead.`,
      );
      continue;
    }

    result[name] = buildGoosePluginStdioServer(config);
  }

  return result;
}

/**
 * Goose MCP servers.
 *
 * Goose configures MCP servers in two locations:
 *
 * - **Global** (`--global`): "extensions" in the shared user config
 *   `~/.config/goose/config.yaml`. That file also holds other Goose settings
 *   (model, provider, ...), so generation merges the `extensions:` block into the
 *   existing config instead of overwriting it, and the file is never deleted.
 *   This location supports both stdio and remote (http/sse) servers.
 * - **Project**: a stdio-only open-plugin manifest at
 *   `.agents/plugins/rulesync/.mcp.json` (Goose v1.39.0+), reusing the same
 *   `.agents/plugins/rulesync/` tree as Goose hooks. The manifest uses the
 *   Claude-style `{ "mcpServers": { "<name>": { command, args, env, cwd } } }`
 *   shape and cannot express `url`/`headers`, so remote servers are skipped with
 *   a warning in project mode (use `--global` to sync them instead).
 *
 * @see https://block.github.io/goose/docs/getting-started/using-extensions/
 * @see https://github.com/block/goose/pull/9471
 */
export class GooseMcp extends ToolMcp {
  private readonly config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent === undefined) {
      this.config = {};
    } else if (params.global) {
      // Global config.yaml is YAML.
      this.config = parseGooseConfig(this.fileContent, this.relativeDirPath, this.relativeFilePath);
    } else {
      // Project `.mcp.json` is a Claude-style JSON manifest. An empty string
      // (e.g. from `forDeletion`) is treated as an empty manifest.
      this.config = this.fileContent ? this.parsePluginManifest(this.fileContent) : {};
    }
  }

  private parsePluginManifest(fileContent: string): Record<string, unknown> {
    try {
      const parsed: unknown = JSON.parse(fileContent);
      return isRecord(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Goose MCP manifest at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override isDeletable(): boolean {
    // Global config.yaml holds other Goose settings, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead. The project
    // `.mcp.json` is a rulesync-owned manifest and can be safely deleted.
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: GOOSE_GLOBAL_DIR,
        relativeFilePath: GOOSE_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: GOOSE_PLUGIN_MCP_DIR_PATH,
      relativeFilePath: GOOSE_PLUGIN_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<GooseMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent =
      (await readFileContentOrNull(filePath)) ??
      (global ? "" : JSON.stringify({ mcpServers: {} }, null, 2));

    return new GooseMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<GooseMcp> {
    const paths = this.getSettablePaths({ global });

    if (!global) {
      // Project: emit a stdio-only Claude-style `.mcp.json` manifest. Remote
      // servers are skipped with a warning (handled in the converter).
      const mcpServers = convertToGoosePluginMcpServers(rulesyncMcp.getMcpServers(), logger);
      return new GooseMcp({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: JSON.stringify({ mcpServers }, null, 2),
        validate,
        global,
      });
    }

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      "",
    );
    const config = parseGooseConfig(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Merge the `extensions:` block into the shared config, preserving other
    // keys (model, provider, ...).
    const merged = { ...config, extensions: convertToGooseFormat(rulesyncMcp.getMcpServers()) };

    return new GooseMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: dump(merged),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    if (!this.global) {
      // Project manifest is already Claude-style canonical `mcpServers`.
      const mcpServers = isRecord(this.config.mcpServers) ? this.config.mcpServers : {};
      return this.toRulesyncMcpDefault({
        fileContent: JSON.stringify({ mcpServers }, null, 2),
      });
    }
    const extensions = isRecord(this.config.extensions) ? this.config.extensions : {};
    const mcpServers = convertFromGooseFormat(extensions);
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
  }: ToolMcpForDeletionParams): GooseMcp {
    return new GooseMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
