import { join } from "node:path";

import { ROO_DIR, ROO_MCP_FILE_NAME } from "../../constants/roo-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import { isPlainObject, isStringArray } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Roo Code uses "streamable-http" instead of "http" for HTTP-based MCP servers
// Since "streamable-http" is not part of the standard MCP type schema,
// we use Record<string, unknown> as the intermediate type for Roo-specific format

type RooMcpServers = Record<string, Record<string, unknown>>;

const MAX_PORT = 65535;

/** Keys of Zoo Code's streamable-http `oauth` object, passed through as written. */
const ZOO_OAUTH_PASSTHROUGH_KEYS = new Set(["clientId", "scope", "redirectUri", "resource"]);

function isValidPort(value: unknown): value is number {
  return Number.isInteger(value) && Number(value) >= 1 && Number(value) <= MAX_PORT;
}

function isUrl(value: unknown): boolean {
  if (typeof value !== "string") return false;
  try {
    new URL(value);
    return true;
  } catch {
    return false;
  }
}

/**
 * Whether a value fits the Zoo Code `oauth` key it is written to: `scope` and
 * `clientId` are strings, `redirectUri` a URL, and `resource` `"auto"`,
 * `false` or a URL. A value that fails here would fail the whole file.
 */
function isValidZooOauthValue(key: string, value: unknown): boolean {
  if (key === "resource") {
    return value === false || value === "auto" || isUrl(value);
  }
  if (key === "redirectUri") {
    return isUrl(value);
  }
  return typeof value === "string";
}

/**
 * Translate a server's canonical (Claude Code style) `oauth` object into the
 * one Zoo Code validates for a `streamable-http` server, or `undefined` when
 * nothing usable is left.
 *
 * Zoo Code validates the whole project `.roo/mcp.json` with one schema and
 * loads none of its servers when any entry fails, so a block it would reject
 * is dropped with a warning rather than written:
 * - `clientId` is required and must not be empty.
 * - `callbackPort` becomes `redirectUri: "http://127.0.0.1:<port>/callback"`,
 *   the loopback callback Zoo Code listens on (an explicit `redirectUri` wins).
 * - `scope`, `redirectUri` and `resource` pass through when their values fit
 *   Zoo Code's schema; a canonical `scopes` list is joined into `scope` when
 *   no `scope` is given. Any other key (e.g. Claude Code's
 *   `authServerMetadataUrl`) is dropped, since Zoo Code would strip it anyway.
 *
 * @see https://github.com/Zoo-Code-Org/Zoo-Code/pull/2129
 */
function convertOauthToRoo(
  oauth: unknown,
  serverName: string,
): Record<string, unknown> | undefined {
  if (!isPlainObject(oauth)) {
    warnWithFallback(
      undefined,
      `[RooMcp] Dropping 'oauth' from MCP server "${serverName}": Zoo Code expects an object there.`,
    );
    return undefined;
  }
  const clientId = oauth["clientId"];
  if (typeof clientId !== "string" || clientId.trim() === "") {
    warnWithFallback(
      undefined,
      `[RooMcp] Dropping 'oauth' from MCP server "${serverName}": Zoo Code requires a non-empty 'oauth.clientId', and a block without one fails the whole .roo/mcp.json.`,
    );
    return undefined;
  }
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oauth)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    if (key === "callbackPort") {
      if (!isValidPort(value)) {
        warnWithFallback(
          undefined,
          `[RooMcp] Dropping malformed 'oauth.callbackPort' from MCP server "${serverName}": expected a port number.`,
        );
      }
      continue;
    }
    if (key === "scopes" && isStringArray(value)) {
      continue;
    }
    if (!ZOO_OAUTH_PASSTHROUGH_KEYS.has(key)) {
      warnWithFallback(
        undefined,
        `[RooMcp] Dropping 'oauth.${key}' from MCP server "${serverName}": Zoo Code does not read that key.`,
      );
      continue;
    }
    if (!isValidZooOauthValue(key, value)) {
      warnWithFallback(
        undefined,
        `[RooMcp] Dropping malformed 'oauth.${key}' from MCP server "${serverName}".`,
      );
      continue;
    }
    result[key] = value;
  }
  const scopes = oauth["scopes"];
  if (!Object.hasOwn(result, "scope") && isStringArray(scopes) && scopes.length > 0) {
    result["scope"] = scopes.join(" ");
  }
  const callbackPort = oauth["callbackPort"];
  if (!Object.hasOwn(result, "redirectUri") && isValidPort(callbackPort)) {
    result["redirectUri"] = `http://127.0.0.1:${callbackPort}/callback`;
  }
  return result;
}

/**
 * Reverse of the `callbackPort` mapping in {@link convertOauthToRoo}: a
 * loopback `redirectUri` of exactly the form generate writes,
 * `http://127.0.0.1:<port>/callback`, is read back as the canonical
 * `callbackPort`. Any other `redirectUri` — including a `localhost` one, which
 * Zoo Code sends verbatim and an OAuth client may be registered with — is kept
 * as written, so a round trip never changes the redirect URI.
 */
function convertOauthFromRoo(oauth: Record<string, unknown>): Record<string, unknown> {
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(oauth)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    result[key] = value;
  }
  const redirectUri = result["redirectUri"];
  if (typeof redirectUri !== "string" || Object.hasOwn(result, "callbackPort")) {
    return result;
  }
  const match = /^http:\/\/127\.0\.0\.1:(\d+)\/callback$/.exec(redirectUri);
  const port = match ? Number(match[1]) : undefined;
  if (isValidPort(port)) {
    delete result["redirectUri"];
    result["callbackPort"] = port;
  }
  return result;
}

/**
 * Convert Rulesync MCP format to Roo MCP format
 * - type: "http" -> "streamable-http"
 * - transport: "http" -> "streamable-http"
 * - `oauth` is kept only on a `streamable-http` server, in the shape Zoo Code
 *   validates; Zoo Code rejects it on stdio and sse servers (see
 *   {@link convertOauthToRoo}). Roo Code never read the key, so the same rules
 *   are safe for the `roo` target that shares this adapter.
 */
function convertToRooFormat(mcpServers: McpServers): RooMcpServers {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted: Record<string, unknown> = { ...serverConfig };
      if (serverConfig.type === "http") {
        converted.type = "streamable-http";
      }
      if (serverConfig.transport === "http") {
        converted.transport = "streamable-http";
      }
      if (converted.oauth !== undefined) {
        // Zoo Code reads `type`, not `transport`, and requires an explicit
        // `type` for url servers, so only `type: "streamable-http"` counts.
        if (converted.type === "streamable-http") {
          const oauth = convertOauthToRoo(converted.oauth, serverName);
          if (oauth === undefined) {
            delete converted.oauth;
          } else {
            converted.oauth = oauth;
          }
        } else {
          delete converted.oauth;
          warnWithFallback(
            undefined,
            `[RooMcp] Dropping 'oauth' from MCP server "${serverName}": Zoo Code accepts it only on a "type": "http" (streamable-http) server, and rejects the whole .roo/mcp.json otherwise.`,
          );
        }
      }
      return [serverName, converted];
    }),
  );
}

/**
 * Convert Roo MCP format to Rulesync MCP format
 * - type: "streamable-http" -> "http"
 * - transport: "streamable-http" -> "http"
 */
function convertFromRooFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const converted: Record<string, unknown> = isPlainObject(serverConfig)
        ? Object.fromEntries(Object.entries(serverConfig))
        : {};
      if (converted.type === "streamable-http") {
        converted.type = "http";
      }
      if (converted.transport === "streamable-http") {
        converted.transport = "http";
      }
      if (isPlainObject(converted.oauth)) {
        converted.oauth = convertOauthFromRoo(converted.oauth);
      }
      return [serverName, converted];
    }),
  );
}

export class RooMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: ROO_DIR,
      relativeFilePath: ROO_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<RooMcp> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );
    return new RooMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): RooMcp {
    const mcpServers = rulesyncMcp.getMcpServers();
    const convertedMcpServers = convertToRooFormat(mcpServers);
    const fileContent = JSON.stringify({ mcpServers: convertedMcpServers }, null, 2);

    return new RooMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const convertedMcpServers = convertFromRooFormat(this.json.mcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertedMcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): RooMcp {
    return new RooMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
