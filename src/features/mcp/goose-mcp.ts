import { join } from "node:path";

import { dump, load } from "js-yaml";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const GOOSE_GLOBAL_ONLY_MESSAGE =
  "Goose MCP is global-only; use --global to sync ~/.config/goose/config.yaml";

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
  if (!isRecord(parsed)) {
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

    const command = config.command;
    const url =
      (typeof config.url === "string" ? config.url : undefined) ??
      (typeof config.httpUrl === "string" ? config.httpUrl : undefined);
    const transport = canonicalTransport(config);

    let gooseType: string;
    if (command !== undefined) {
      gooseType = "stdio";
    } else if (url !== undefined) {
      gooseType = transport === "sse" ? "sse" : "streamable_http";
    } else {
      gooseType = transport === "builtin" ? "builtin" : "stdio";
    }

    const ext: Record<string, unknown> = { name, type: gooseType };

    if (gooseType === "stdio") {
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
      if (isRecord(config.env)) ext.envs = config.env;
    } else if (gooseType === "sse" || gooseType === "streamable_http") {
      if (url !== undefined) ext.uri = url;
      if (isRecord(config.headers)) ext.headers = config.headers;
    }

    ext.enabled = config.disabled !== true;

    const timeout =
      typeof config.timeout === "number"
        ? config.timeout
        : typeof config.networkTimeout === "number"
          ? config.networkTimeout
          : undefined;
    if (timeout !== undefined) ext.timeout = timeout;

    extensions[name] = ext;
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
    if (isRecord(ext.envs)) server.env = ext.envs;
    if (typeof ext.uri === "string") server.url = ext.uri;
    if (isRecord(ext.headers)) server.headers = ext.headers;
    if (ext.enabled === false) server.disabled = true;
    if (typeof ext.timeout === "number") server.timeout = ext.timeout;

    result[name] = server;
  }

  return result;
}

/**
 * Goose MCP servers.
 *
 * Goose configures MCP servers as "extensions" in the shared user config file
 * `~/.config/goose/config.yaml` (global only — Goose has no project-scoped MCP
 * location). That file also holds other Goose settings (model, provider, ...),
 * so generation merges the `extensions:` block into the existing config instead
 * of overwriting it, and the file is never deleted.
 *
 * @see https://block.github.io/goose/docs/getting-started/using-extensions/
 */
export class GooseMcp extends ToolMcp {
  private readonly config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.config = parseGooseConfig(this.fileContent, this.relativeDirPath, this.relativeFilePath);
    } else {
      this.config = {};
    }
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override isDeletable(): boolean {
    // config.yaml holds other Goose settings, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: join(".config", "goose"),
      relativeFilePath: "config.yaml",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<GooseMcp> {
    if (!global) {
      throw new Error(GOOSE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

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
  }: ToolMcpFromRulesyncMcpParams): Promise<GooseMcp> {
    if (!global) {
      throw new Error(GOOSE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

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
