import { join } from "node:path";

import { dump, load } from "js-yaml";

import {
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_MCP_FILE_NAME,
} from "../../constants/hermesagent-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
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

const HERMESAGENT_GLOBAL_ONLY_MESSAGE =
  "Hermes Agent MCP is global-only; use --global to sync ~/.hermes/config.yaml";

function parseHermesConfig(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = load(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Hermes config at ${configPath}: ${formatError(error)}`, {
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
    throw new Error(`Failed to parse Hermes config at ${configPath}: expected a YAML mapping`);
  }
  return parsed;
}

/**
 * Resolves the canonical remote URL for a server (`url` or the `httpUrl` alias).
 */
function resolveHermesUrl(config: Record<string, unknown>): string | undefined {
  return (
    (typeof config.url === "string" ? config.url : undefined) ??
    (typeof config.httpUrl === "string" ? config.httpUrl : undefined)
  );
}

/**
 * Resolves the canonical timeout for a server (`timeout` or the `networkTimeout` alias).
 */
function resolveHermesTimeout(config: Record<string, unknown>): number | undefined {
  if (typeof config.timeout === "number") return config.timeout;
  if (typeof config.networkTimeout === "number") return config.networkTimeout;
  return undefined;
}

/**
 * Converts a single rulesync canonical MCP server into a Hermes `mcp_servers:` entry.
 *
 * Hermes is close to the MCP spec but not identical: `command` must be a single
 * executable string (an array's tail folds into `args`), a server is disabled
 * via `enabled: false` (not the canonical `disabled: true`), and remote servers
 * use `url`/`headers`. Only fields Hermes understands are emitted, so the shared
 * `config.yaml` is not polluted with canonical-only aliases (`type`, `transport`,
 * `httpUrl`, `networkTimeout`, tool-filter keys, ...).
 */
function convertServerToHermes(config: Record<string, unknown>): Record<string, unknown> {
  const out: Record<string, unknown> = {};

  const command = config.command;
  const url = resolveHermesUrl(config);

  if (command !== undefined) {
    if (Array.isArray(command)) {
      if (typeof command[0] === "string") out.command = command[0];
      const rest = command.slice(1).filter((c): c is string => typeof c === "string");
      const args = isStringArray(config.args) ? config.args : [];
      if (rest.length > 0 || args.length > 0) out.args = [...rest, ...args];
    } else if (typeof command === "string") {
      out.command = command;
      if (isStringArray(config.args)) out.args = config.args;
    }
    if (isPlainObject(config.env)) out.env = omitPrototypePollutionKeys(config.env);
  } else if (url !== undefined) {
    out.url = url;
    if (isPlainObject(config.headers)) out.headers = omitPrototypePollutionKeys(config.headers);
  }

  // Hermes defaults a server to enabled, so only emit the flag when disabling.
  if (config.disabled === true) out.enabled = false;

  const timeout = resolveHermesTimeout(config);
  if (timeout !== undefined) out.timeout = timeout;

  return out;
}

/**
 * Converts rulesync canonical MCP servers into Hermes `mcp_servers:` entries.
 */
function convertToHermesFormat(mcpServers: McpServers): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    result[name] = convertServerToHermes(config);
  }

  return result;
}

function mergeHermesMcpServers(
  config: Record<string, unknown>,
  mcpServers: Record<string, Record<string, unknown>>,
): Record<string, unknown> {
  const existingMcpServers = isRecord(config.mcp_servers) ? config.mcp_servers : {};

  return {
    ...config,
    mcp_servers: {
      ...existingMcpServers,
      ...mcpServers,
    },
  };
}

/**
 * Converts Hermes `mcp_servers:` entries back into rulesync canonical MCP servers.
 *
 * Mirrors {@link convertToHermesFormat}: `enabled: false` maps back to the
 * canonical `disabled: true`, and only recognized fields are carried over.
 */
function convertFromHermesFormat(mcpServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;

    const server: Record<string, unknown> = {};
    if (typeof config.command === "string") server.command = config.command;
    if (isStringArray(config.args)) server.args = config.args;
    if (isPlainObject(config.env)) server.env = omitPrototypePollutionKeys(config.env);
    if (typeof config.url === "string") server.url = config.url;
    if (isPlainObject(config.headers)) server.headers = omitPrototypePollutionKeys(config.headers);
    if (config.enabled === false) server.disabled = true;
    if (typeof config.timeout === "number") server.networkTimeout = config.timeout;

    result[name] = server;
  }

  return result;
}

/**
 * Hermes Agent MCP servers.
 *
 * Hermes Agent configures MCP servers under the top-level `mcp_servers` key of
 * the shared user config file `~/.hermes/config.yaml` (the HERMES_HOME directory;
 * global only — Hermes has no project-scoped MCP location). That file also holds
 * other Hermes settings (model, terminal, ...), so generation merges the
 * `mcp_servers:` block into the existing config instead of overwriting it, and
 * the file is never deleted.
 */
export class HermesagentMcp extends ToolMcp {
  private config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.config = parseHermesConfig(
        this.fileContent,
        this.relativeDirPath,
        this.relativeFilePath,
      );
    } else {
      this.config = {};
    }
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override setFileContent(fileContent: string): void {
    const config = parseHermesConfig(fileContent, this.relativeDirPath, this.relativeFilePath);
    const mcpServers = isRecord(this.config.mcp_servers) ? this.config.mcp_servers : {};
    const merged = mergeHermesMcpServers(
      config,
      mcpServers as Record<string, Record<string, unknown>>,
    );

    this.config = merged;
    super.setFileContent(dump(merged));
  }

  override isDeletable(): boolean {
    // config.yaml holds other Hermes settings, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new HermesagentMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      "",
    );
    const config = parseHermesConfig(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Merge the `mcp_servers:` block into the shared config, preserving other
    // keys (model, terminal, ...).
    const merged = mergeHermesMcpServers(
      config,
      convertToHermesFormat(rulesyncMcp.getMcpServers()),
    );

    return new HermesagentMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: dump(merged),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isRecord(this.config.mcp_servers) ? this.config.mcp_servers : {};
    const servers = convertFromHermesFormat(mcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: servers }, null, 2),
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
  }: ToolMcpForDeletionParams): HermesagentMcp {
    return new HermesagentMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
