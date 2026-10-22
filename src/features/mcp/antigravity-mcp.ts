import { join } from "node:path";

import {
  ANTIGRAVITY_DIR,
  ANTIGRAVITY_GEMINI_DIR,
  ANTIGRAVITY_MCP_FILE_NAME,
} from "../../constants/antigravity-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import { isPlainObject } from "../../utils/type-guards.js";
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
 * Rename a single field on every MCP server entry, preserving field order and
 * leaving servers that lack the source field untouched.
 */
function renameServerField(servers: unknown, from: string, to: string): Record<string, unknown> {
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => {
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        return [name, config];
      }
      const renamed = Object.fromEntries(
        Object.entries(config).map(([key, value]) => (key === from ? [to, value] : [key, value])),
      );
      return [name, renamed];
    }),
  );
}

function isEmptyValue(value: unknown): boolean {
  if (Array.isArray(value)) {
    return value.length === 0;
  }
  return isPlainObject(value) && Object.keys(value).length === 0;
}

/**
 * Antigravity uses `serverUrl` (not the canonical `url`) for HTTP/SSE MCP
 * servers. Convert the canonical shape into Antigravity's on the way out, and
 * back to canonical on the way in.
 *
 * Antigravity documents no `type` field: the transport follows from `command`
 * (stdio) or `serverUrl` (Streamable HTTP / SSE), and `agy plugin validate`
 * reports the canonical `type` as an unknown field, so it is not written. A
 * remote server that carries `command`, `args` or `env` was also observed to be
 * refused at startup (runtime behavior reported by `agy plugin validate` 1.4.4,
 * not documented), so an empty `args` / `env` left on a `serverUrl` server is
 * dropped.
 * https://antigravity.google/docs/mcp
 */
function toAntigravityMcpServers(servers: unknown): Record<string, unknown> {
  const renamed = renameServerField(servers, "url", "serverUrl");
  return Object.fromEntries(
    Object.entries(renamed).map(([name, config]) => {
      if (!isPlainObject(config)) {
        return [name, config];
      }
      const isRemote = typeof config.serverUrl === "string";
      const converted = Object.fromEntries(
        Object.entries(config).filter(
          ([key, value]) =>
            key !== "type" &&
            !(isRemote && (key === "args" || key === "env") && isEmptyValue(value)),
        ),
      );
      return [name, converted];
    }),
  );
}

function toCanonicalMcpServers(servers: unknown): Record<string, unknown> {
  return renameServerField(servers, "serverUrl", "url");
}

/**
 * Parse `mcp_config.json` as JSONC and require a top-level object, so a file
 * whose root is `null`, an array or a primitive fails with a clear message
 * instead of a `TypeError` on `mcpServers` access or an array being spread
 * into the rewritten config.
 */
function parseAntigravityMcpConfig(fileContent: string): Record<string, unknown> {
  const parsed = parseJsonc(fileContent);
  if (parsed === null || typeof parsed !== "object" || Array.isArray(parsed)) {
    throw new Error(
      `Antigravity ${ANTIGRAVITY_MCP_FILE_NAME} must contain a top-level JSON object`,
    );
  }
  return { ...parsed };
}

/**
 * Shared MCP generator for Google Antigravity (Antigravity 2.0), used by both
 * the IDE and the CLI.
 *
 * Antigravity writes a dedicated `mcp_config.json` whose `mcpServers` map lives
 * at the top level (`disabledTools` per server is supported). Unlike Gemini
 * CLI's shared `settings.json`, this file is dedicated to MCP, so it is safely
 * deletable. HTTP servers use `serverUrl` rather than the canonical `url`, so
 * the field is translated in both directions.
 *
 * The IDE and CLI share the project path (`.agents/mcp_config.json`) and differ
 * only in their global config subdirectory, which each concrete subclass
 * supplies via {@link AntigravityMcp.getGlobalSubdir}.
 *
 * Antigravity CLI 1.1.24+ accepts line and block comments and trailing
 * commas in `mcp_config.json`, so the file is read as JSONC. Writes stay plain
 * JSON (comments are dropped on rewrite), matching the other JSONC-reading
 * adapters.
 */
export class AntigravityMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseAntigravityMcpConfig(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /** Global config subdirectory under `~/.gemini/` (e.g. `antigravity` for the IDE, `config` for the CLI's shared tree). */
  protected static getGlobalSubdir(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(ANTIGRAVITY_GEMINI_DIR, this.getGlobalSubdir()),
        relativeFilePath: ANTIGRAVITY_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ANTIGRAVITY_DIR,
      relativeFilePath: ANTIGRAVITY_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<AntigravityMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = parseAntigravityMcpConfig(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<AntigravityMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseAntigravityMcpConfig(fileContent);
    const newJson = { ...json, mcpServers: toAntigravityMcpServers(rulesyncMcp.getMcpServers()) };

    return new this({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        { mcpServers: toCanonicalMcpServers(this.json.mcpServers) },
        null,
        2,
      ),
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
  }: ToolMcpForDeletionParams): AntigravityMcp {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
