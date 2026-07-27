import { join } from "node:path";

import { ROVODEV_DIR, ROVODEV_MCP_FILE_NAME } from "../../constants/rovodev-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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

function parseRovodevMcpJson(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Rovodev MCP config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Rovodev MCP config at ${configPath}: expected a JSON object`);
  }
  return parsed;
}

/**
 * Rovodev MCP: global only at ~/.rovodev/mcp.json.
 * Same shape as Cursor: { mcpServers: { ... } }. See Rovodev MCP docs.
 * Project-level MCP is not supported; use --global when generating.
 */

/**
 * Rovo Dev documents the per-server transport key as `transport`, with the
 * values `stdio` | `http` | `sse`. Canonical rulesync configs spell it `type`,
 * so translate rather than passing the canonical key through — Rovo Dev has no
 * documented `type` alias.
 *
 * @see https://support.atlassian.com/rovo/docs/connect-to-an-mcp-server-in-rovo-dev-cli/
 */
const CANONICAL_TO_ROVODEV_TRANSPORT: Record<string, string> = {
  stdio: "stdio",
  local: "stdio",
  http: "http",
  "streamable-http": "http",
  sse: "sse",
};

const ROVODEV_TO_CANONICAL_TRANSPORT: Record<string, string> = {
  stdio: "stdio",
  http: "http",
  sse: "sse",
};

function toRovodevServer(
  name: string,
  server: Record<string, unknown>,
  logger?: Logger,
): Record<string, unknown> | null {
  // `disabled` is dropped either way: `mcp.json` has no such key, so keeping a
  // `false` would suggest the file is where a server is switched on and off.
  const { type, transport, disabled, ...rest } = server;
  // Rovo Dev disables a server through `mcp.disabledMcpServers` in `config.yml`,
  // not through a per-server key in `mcp.json`, so a `disabled` server written
  // here would simply run. Omit it instead — the same end state, fail-closed.
  if (disabled === true) {
    logger?.warn(
      `Rovo Dev MCP: skipping "${name}" because it is disabled and mcp.json has no disable flag.`,
    );
    return null;
  }
  const declared =
    typeof transport === "string" ? transport : typeof type === "string" ? type : undefined;
  if (declared === undefined) {
    return rest;
  }
  const mapped = CANONICAL_TO_ROVODEV_TRANSPORT[declared];
  if (mapped === undefined) {
    // `ws` is the only canonical transport Rovo Dev has no equivalent for.
    // Skip the whole entry rather than emit one whose transport is anyone's
    // guess, matching the Kimi Code adapter over the same vocabulary.
    logger?.warn(
      `Rovo Dev MCP: skipping "${name}" because the "${declared}" transport is unsupported.`,
    );
    return null;
  }
  return { ...rest, transport: mapped };
}

function fromRovodevServer(server: Record<string, unknown>): Record<string, unknown> {
  const { transport, ...rest } = server;
  if (typeof transport !== "string") {
    return rest;
  }
  const mapped = ROVODEV_TO_CANONICAL_TRANSPORT[transport];
  // A value outside Rovo Dev's vocabulary (a typo, or one Atlassian adds later)
  // is dropped rather than carried over: the canonical transport field is a
  // strict enum, so writing it through would make `.rulesync/mcp.json` fail to
  // parse on the next run — for every target, not just this one.
  return mapped === undefined ? rest : { ...rest, type: mapped };
}

export class RovodevMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.json = parseRovodevMcpJson(
        this.fileContent,
        this.relativeDirPath,
        this.relativeFilePath,
      );
    } else {
      this.json = {};
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: ROVODEV_DIR,
      relativeFilePath: ROVODEV_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<RovodevMcp> {
    if (!global) {
      throw new Error("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new RovodevMcp({
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
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<RovodevMcp> {
    if (!global) {
      throw new Error("Rovodev MCP is global-only; use --global to sync ~/.rovodev/mcp.json");
    }
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // rovodev config.
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers())
        .map(([name, server]) => {
          const converted = toRovodevServer(name, server as Record<string, unknown>, logger);
          return converted === null ? null : ([name, converted] as const);
        })
        .filter((entry) => entry !== null),
    );

    const rovodevConfig = { ...json, mcpServers };

    return new RovodevMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(rovodevConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const rawServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    const mcpServers = Object.fromEntries(
      Object.entries(rawServers)
        // `isMcpServers` only checks the container, so a hand-written `null` or
        // scalar entry reaches here; skip it rather than destructure it.
        .filter(([, server]) => isPlainObject(server))
        .map(([name, server]) => [name, fromRovodevServer(server as Record<string, unknown>)]),
    );
    // Do not spread the full Rovodev JSON: future tool-specific top-level keys must not leak
    // into rulesync mcp.json (unlike Cursor, which intentionally preserves extra keys today).
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
  }: ToolMcpForDeletionParams): RovodevMcp {
    return new RovodevMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
