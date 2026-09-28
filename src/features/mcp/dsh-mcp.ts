import { join } from "node:path";

import { CORE_SCHEMA, defineScalarTag, DUMP_SCHEMA, dump } from "js-yaml";

import {
  DSH_CORDIS_PATCH_FILE_NAME,
  DSH_DIR,
  DSH_MCP_CLIENT_PLUGIN_NAME,
} from "../../constants/dsh-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { McpServer, McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isStringArray } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const DSH_GLOBAL_ONLY_MESSAGE =
  "DeepSeek Harness MCP is global-only; use --global to sync ~/.dsh/cordis.patch.yml";

/**
 * An unevaluated Cordis `!!js` expression (`cwd: !!js process.cwd()`). Kept as
 * an opaque value so the patch entries rulesync does not own are written back
 * with the tag intact; js-yaml's default schema rejects the tag outright.
 */
class DshJsExpression {
  constructor(readonly source: string) {}
}

const DSH_JS_TAG = defineScalarTag<DshJsExpression>("tag:yaml.org,2002:js", {
  resolve: (source) => new DshJsExpression(source),
  identify: (data) => data instanceof DshJsExpression,
  represent: (data: DshJsExpression) => data.source,
});

const DSH_LOAD_SCHEMA = CORE_SCHEMA.withTags(DSH_JS_TAG);
const DSH_DUMP_SCHEMA = DUMP_SCHEMA.withTags(DSH_JS_TAG);

/** `serverName` pattern enforced by `@deepseek-ai/dsh-mcp-client`. */
const DSH_SERVER_NAME_PATTERN = /^[A-Za-z0-9_-]{1,32}$/;

/**
 * `@deepseek-ai/dsh-mcp-client` config keys with no canonical counterpart.
 * They round-trip through the `dsh.mcpServers` block rather than the shared
 * `mcpServers` map, so they never leak into other tools' configs.
 * `toolCallTimeoutMs` is not derived from the canonical `timeout`, whose unit
 * differs between tools.
 */
const DSH_PASSTHROUGH_FIELDS = [
  "toolCallTimeoutMs",
  "failOnStartupError",
  "maxInstructionBytes",
  "reconnect",
] as const;

type DshTransport = "stdio" | "streamable-http";

type DshMcpRow = {
  id: string;
  name: typeof DSH_MCP_CLIENT_PLUGIN_NAME;
  disabled?: true;
  config: Record<string, unknown>;
};

/**
 * Parse the Cordis patch list. The root is a YAML sequence of patch entries;
 * an empty (or comment-only) file is an empty list. Any other root is refused
 * rather than overwritten, since the file carries the user's own patches.
 */
function parseCordisPatchList(fileContent: string): unknown[] {
  let parsed: unknown;
  try {
    parsed = loadYaml(fileContent, { schema: DSH_LOAD_SCHEMA });
  } catch (error) {
    throw new Error(`Failed to parse DeepSeek Harness cordis.patch.yml: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (parsed === undefined || parsed === null) {
    return [];
  }
  if (!Array.isArray(parsed)) {
    throw new Error(
      "DeepSeek Harness cordis.patch.yml must be a YAML list of patch entries; refusing to overwrite it",
    );
  }
  return parsed;
}

function stringifyCordisPatchList(entries: unknown[]): string {
  return dump(entries, { schema: DSH_DUMP_SCHEMA, noRefs: true, lineWidth: -1 });
}

function isMcpClientRow(row: unknown): row is Record<string, unknown> {
  return isPlainObject(row) && row.name === DSH_MCP_CLIENT_PLUGIN_NAME;
}

/** Every `@deepseek-ai/dsh-mcp-client` row across the file's `insert` entries. */
function collectMcpClientRows(entries: unknown[]): Record<string, unknown>[] {
  return entries.flatMap((entry) =>
    isPlainObject(entry) && Array.isArray(entry.insert) ? entry.insert.filter(isMcpClientRow) : [],
  );
}

function getRowServerName(row: Record<string, unknown>): string | undefined {
  const config = row.config;
  return isPlainObject(config) && typeof config.serverName === "string"
    ? config.serverName
    : undefined;
}

/**
 * Replace every `@deepseek-ai/dsh-mcp-client` row with `rows`, leaving all
 * other patch entries and rows untouched. The new rows take the place of the
 * first existing MCP row so any later entry that targets them by `id` still
 * follows them; an `insert` entry left empty by the removal is dropped. With no
 * existing MCP row, the rows are appended as one new `insert` entry.
 */
function replaceMcpClientRows(entries: unknown[], rows: DshMcpRow[]): unknown[] {
  let placed = false;
  const result: unknown[] = [];
  for (const entry of entries) {
    if (!isPlainObject(entry) || !Array.isArray(entry.insert)) {
      result.push(entry);
      continue;
    }
    if (!entry.insert.some(isMcpClientRow)) {
      result.push(entry);
      continue;
    }
    const insert: unknown[] = [];
    for (const row of entry.insert) {
      if (!isMcpClientRow(row)) {
        insert.push(row);
      } else if (!placed) {
        insert.push(...rows);
        placed = true;
      }
    }
    if (insert.length > 0) {
      result.push({ ...entry, insert });
    }
  }
  if (!placed && rows.length > 0) {
    result.push({ insert: rows });
  }
  return result;
}

function resolveDshTransport(
  server: McpServer,
): DshTransport | { unsupported: string } | undefined {
  const candidate = server.type ?? server.transport;
  if (candidate === "stdio" || candidate === "local") return "stdio";
  if (candidate === "http" || candidate === "streamable-http") return "streamable-http";
  if (candidate !== undefined) return { unsupported: candidate };
  if (server.command !== undefined) return "stdio";
  const url = server.url ?? server.httpUrl;
  if (typeof url === "string") {
    return /^wss?:\/\//i.test(url) ? { unsupported: "ws" } : "streamable-http";
  }
  return undefined;
}

function copyPassthroughFields(
  source: Record<string, unknown>,
  target: Record<string, unknown>,
): boolean {
  let copied = false;
  for (const field of DSH_PASSTHROUGH_FIELDS) {
    const value = source[field];
    if (field === "reconnect") {
      if (isPlainObject(value)) {
        target[field] = omitPrototypePollutionKeys(structuredClone(value));
        copied = true;
      }
    } else if (typeof value === "number" || typeof value === "boolean") {
      target[field] = value;
      copied = true;
    }
  }
  return copied;
}

/** Transport-specific config fields, or the reason the server cannot be written. */
function buildStdioFields(server: McpServer): Record<string, unknown> | string {
  const [command, ...commandArgs] = Array.isArray(server.command)
    ? server.command
    : [server.command];
  if (typeof command !== "string" || command === "") return "it has no command";
  const fields: Record<string, unknown> = { command };
  const args = [...commandArgs, ...(server.args ?? [])];
  if (args.length > 0) fields.args = args;
  if (isPlainObject(server.env)) fields.env = omitPrototypePollutionKeys(server.env);
  if (typeof server.cwd === "string") fields.cwd = server.cwd;
  return fields;
}

function buildStreamableHttpFields(server: McpServer): Record<string, unknown> | string {
  const url = server.url ?? server.httpUrl;
  if (typeof url !== "string" || url === "") return "it has no URL";
  const fields: Record<string, unknown> = { url };
  if (isPlainObject(server.headers)) fields.headers = omitPrototypePollutionKeys(server.headers);
  return fields;
}

function convertServerToDshRow({
  name,
  server,
  existingIds,
  logger,
}: {
  name: string;
  server: McpServer;
  existingIds: Map<string, string>;
  logger?: Logger;
}): DshMcpRow | null {
  const skip = (reason: string): null => {
    logger?.warn(`DeepSeek Harness MCP: skipping "${name}" because ${reason}.`);
    return null;
  };
  if (!DSH_SERVER_NAME_PATTERN.test(name)) {
    return skip("dsh requires server names to match [A-Za-z0-9_-]{1,32}");
  }
  const transport = resolveDshTransport(server);
  if (transport === undefined) return skip("it has neither a command nor a URL");
  if (typeof transport === "object") {
    return skip(
      `it uses the "${transport.unsupported}" transport, which dsh does not implement ` +
        `(only stdio and streamable-http)`,
    );
  }

  const fields =
    transport === "stdio" ? buildStdioFields(server) : buildStreamableHttpFields(server);
  if (typeof fields === "string") return skip(fields);

  const config: Record<string, unknown> = { serverName: name, transport, ...fields };
  copyPassthroughFields(server as Record<string, unknown>, config);

  return {
    id: existingIds.get(name) ?? `mcp-${name}`,
    name: DSH_MCP_CLIENT_PLUGIN_NAME,
    ...(server.disabled === true && { disabled: true }),
    config,
  };
}

/** String-valued map entries only: a `!!js` expression has no canonical form. */
function copyStringRecord(value: unknown): Record<string, string> | undefined {
  if (!isPlainObject(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, entry] of Object.entries(value)) {
    if (!PROTOTYPE_POLLUTION_KEYS.has(key) && typeof entry === "string") {
      result[key] = entry;
    }
  }
  return result;
}

function convertRowsFromDsh(rows: Record<string, unknown>[]): {
  mcpServers: McpServers;
  dshOverrides: McpServers;
} {
  const mcpServers: McpServers = {};
  const dshOverrides: McpServers = {};
  for (const row of rows) {
    const config = row.config;
    const name = getRowServerName(row);
    if (!isPlainObject(config) || name === undefined || PROTOTYPE_POLLUTION_KEYS.has(name)) {
      continue;
    }
    const server: Record<string, unknown> = {};
    if (config.transport === "streamable-http") {
      server.type = "http";
      if (typeof config.url === "string") server.url = config.url;
      const headers = copyStringRecord(config.headers);
      if (headers !== undefined) server.headers = headers;
    } else {
      server.type = "stdio";
      if (typeof config.command === "string") server.command = config.command;
      if (isStringArray(config.args)) server.args = config.args;
      const env = copyStringRecord(config.env);
      if (env !== undefined) server.env = env;
      if (typeof config.cwd === "string") server.cwd = config.cwd;
    }
    if (row.disabled === true) server.disabled = true;

    mcpServers[name] = server;
    const dshServer = { ...server };
    if (copyPassthroughFields(config, dshServer)) {
      dshOverrides[name] = dshServer;
    }
  }
  return { mcpServers, dshOverrides };
}

/**
 * DeepSeek Harness (`dsh`) MCP servers.
 *
 * dsh persists MCP servers as `insert` rows of the `@deepseek-ai/dsh-mcp-client`
 * plugin in a Cordis patch layer. Rulesync writes the home-level
 * `~/.dsh/cordis.patch.yml` (global only — dsh has no project-scoped MCP file).
 * That file also carries the user's other patches, so rulesync owns only the
 * `@deepseek-ai/dsh-mcp-client` rows: they are rewritten as a whole, every other
 * entry is preserved (including `!!js` expressions), and the file is never
 * deleted.
 *
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/docs/user/guide/mcp-memory.md
 * @see https://github.com/deepseek-ai/deepseek-harness/blob/master/packages/mcp/mcp-client/README.md
 */
export class DshMcp extends ToolMcp {
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: DSH_DIR,
      relativeFilePath: DSH_CORDIS_PATCH_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<DshMcp> {
    if (!global) {
      throw new Error(DSH_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new DshMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<DshMcp> {
    if (!global) {
      throw new Error(DSH_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const entries = parseCordisPatchList(existingContent);

    // Keep the `id` of an existing row for the same server: other patch layers
    // (the profile patch, `--patch` overlays) target rows by `id`.
    const existingIds = new Map<string, string>();
    for (const row of collectMcpClientRows(entries)) {
      const serverName = getRowServerName(row);
      if (serverName !== undefined && typeof row.id === "string" && !existingIds.has(serverName)) {
        existingIds.set(serverName, row.id);
      }
    }

    const rows = Object.entries(rulesyncMcp.getMcpServers())
      .filter(([name]) => !PROTOTYPE_POLLUTION_KEYS.has(name))
      .map(([name, server]) => convertServerToDshRow({ name, server, existingIds, logger }))
      .filter((row) => row !== null);

    return new DshMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: stringifyCordisPatchList(replaceMcpClientRows(entries, rows)),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const { mcpServers, dshOverrides } = convertRowsFromDsh(
      collectMcpClientRows(parseCordisPatchList(this.fileContent)),
    );
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers,
          ...(Object.keys(dshOverrides).length > 0 && { dsh: { mcpServers: dshOverrides } }),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    try {
      parseCordisPatchList(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return { success: false, error: error instanceof Error ? error : new Error(String(error)) };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): DshMcp {
    return new DshMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
