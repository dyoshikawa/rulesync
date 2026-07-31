import { join } from "node:path";

import {
  ROVODEV_CONFIG_FILE_NAME,
  ROVODEV_DIR,
  ROVODEV_MCP_FILE_NAME,
} from "../../constants/rovodev-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers } from "../../types/mcp.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject, isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  ROVODEV_CONFIG_SHARED_FILE_KEY,
  applySharedConfigPatch,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
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
 * Rovodev MCP: `~/.rovodev/mcp.json` (global) and the repo-committed project
 * `.rovodev/mcp.json` documented by the Bitbucket Cloud Agentic Pipelines
 * guide ("Register your MCP server in `.rovodev/mcp.json`", referenced via
 * `mcp.mcpConfigPath`). Same shape as Cursor: { mcpServers: { ... } }.
 * A server the canonical config marks `disabled: true` is still written here
 * and switched off through `mcp.disabledMcpServers` in the sibling
 * `config.yml` — the file Rovo Dev actually consults for disabling.
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

// Own properties only: a server declaring `__proto__` would otherwise resolve to
// `Object.prototype` and land in the config as a transport value.
function lookupTransport(map: Record<string, string>, key: string): string | undefined {
  return Object.hasOwn(map, key) ? map[key] : undefined;
}

function toRovodevServer(
  name: string,
  server: Record<string, unknown>,
  logger?: Logger,
): Record<string, unknown> | null {
  // `disabled` is dropped from the entry: `mcp.json` has no such key. The
  // toggle itself is written to `mcp.disabledMcpServers` in `config.yml` by
  // `getAuxiliaryFiles`, so the server definition survives and can be
  // re-enabled without re-authoring it.
  const { type, transport, disabled: _disabled, ...rest } = server;
  const declared =
    typeof transport === "string" ? transport : typeof type === "string" ? type : undefined;
  if (declared === undefined) {
    return rest;
  }
  const mapped = lookupTransport(CANONICAL_TO_ROVODEV_TRANSPORT, declared);
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
  const mapped = lookupTransport(ROVODEV_TO_CANONICAL_TRANSPORT, transport);
  // A value outside Rovo Dev's vocabulary (a typo, or one Atlassian adds later)
  // is dropped rather than carried over: the canonical transport field is a
  // strict enum, so writing it through would make `.rulesync/mcp.json` fail to
  // parse on the next run — for every target, not just this one.
  return mapped === undefined ? rest : { ...rest, type: mapped };
}

/**
 * Read the sibling `config.yml` (same scope root as `mcp.json`) and return the
 * parsed document, `null` when the file does not exist. A malformed file
 * **throws**: the disable toggle lives here, so pretending a broken file says
 * nothing would silently re-enable servers on import and leave disabled ones
 * running on generate — both flip a security toggle the wrong way.
 */
async function readRovodevConfigYaml({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<Record<string, unknown> | null> {
  const content = await readFileContentOrNull(
    join(outputRoot, ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
  );
  if (content === null) {
    return null;
  }
  return parseSharedConfig({
    format: "yaml",
    fileContent: content,
    filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
  });
}

function disabledNamesOf(config: Record<string, unknown> | null): string[] {
  const mcpBlock = config && isRecord(config.mcp) ? config.mcp : {};
  return isStringArray(mcpBlock.disabledMcpServers) ? mcpBlock.disabledMcpServers : [];
}

/**
 * Auxiliary writer for the `mcp:` block of `.rovodev/config.yml` (project) /
 * `~/.rovodev/config.yml` (global). Carries `disabledMcpServers` — the key
 * Rovo Dev actually consults to switch a server off — recomputed from the
 * existing block so user keys (`mcpConfigPath`, `allowedMcpServers`, ...) and
 * disabled names for servers rulesync does not manage survive.
 */
export class RovodevMcpConfigYaml extends ToolFile {
  override isDeletable(): boolean {
    // Shared with the permissions feature and the user's own settings; only
    // the `mcp` key is rulesync-managed here.
    return false;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
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
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    // Rovo Dev disables servers through `mcp.disabledMcpServers` in the
    // sibling `config.yml`. Overlay `disabled: true` on the named entries so
    // import round-trips the toggle into the canonical config. A malformed
    // config.yml throws here (fail-closed): importing past it would re-enable
    // every disabled server in the canonical config.
    const disabledNames = disabledNamesOf(await readRovodevConfigYaml({ outputRoot }));
    if (disabledNames.length > 0 && isMcpServers(newJson.mcpServers)) {
      const servers = newJson.mcpServers as Record<string, unknown>;
      for (const name of disabledNames) {
        // Own-property guard: a committed `__proto__` entry in
        // `disabledMcpServers` must not mutate the object's prototype.
        if (!Object.hasOwn(servers, name)) {
          continue;
        }
        const server = servers[name];
        if (isPlainObject(server)) {
          servers[name] = { ...server, disabled: true };
        }
      }
    }

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
    const paths = this.getSettablePaths({ global });

    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? JSON.stringify({ mcpServers: {} }, null, 2);
    const json = parseRovodevMcpJson(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // The off-switch for disabled servers lives in the sibling `config.yml`
    // (written by `getAuxiliaryFiles`). When that file exists but cannot be
    // parsed, the toggle cannot be written — so a disabled server's runnable
    // definition must NOT be written either, or it would simply run
    // (fail-closed: restore the old skip for exactly those entries).
    let canWriteDisableToggle = true;
    try {
      await readRovodevConfigYaml({ outputRoot });
    } catch {
      canWriteDisableToggle = false;
    }

    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // rovodev config.
    const mcpServers = Object.fromEntries(
      Object.entries(rulesyncMcp.getMcpServers())
        .map(([name, server]) => {
          const record = server as Record<string, unknown>;
          if (record.disabled === true && !canWriteDisableToggle) {
            logger?.warn(
              `Rovo Dev MCP: skipping disabled server "${name}" because config.yml cannot be ` +
                `parsed, so mcp.disabledMcpServers cannot be written to switch it off.`,
            );
            return null;
          }
          const converted = toRovodevServer(name, record, logger);
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

  /**
   * `mcp.disabledMcpServers` lives in the shared `config.yml` the permissions
   * feature also writes. Declared here so the write-order derivation sees this
   * feature as one of that file's writers — it is not a settable path, since
   * the servers themselves live in `mcp.json`.
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return [{ relativeDirPath: ROVODEV_DIR, relativeFilePath: ROVODEV_CONFIG_FILE_NAME }];
  }

  static override async getAuxiliaryFiles({
    outputRoot = process.cwd(),
    global = false,
    rulesyncMcp,
    logger,
  }: {
    outputRoot?: string;
    global?: boolean;
    rulesyncMcp: RulesyncMcp;
    logger?: Logger;
  }): Promise<ToolFile[]> {
    const targeted = rulesyncMcp.forTarget({ toolTarget: "rovodev", logger });
    const servers = targeted.getMcpServers();
    const managedNames = Object.keys(servers);
    const disabledNames = managedNames.filter((name) => {
      const server = servers[name];
      return isRecord(server) && server.disabled === true;
    });

    const configPath = join(outputRoot, ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME);
    const existingContent = (await readFileContentOrNull(configPath)) ?? "";
    let existingParsed: Record<string, unknown>;
    try {
      existingParsed = parseSharedConfig({
        format: "yaml",
        fileContent: existingContent,
        filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
      });
    } catch (error) {
      // Skip only this file: the servers in `mcp.json` must still be written
      // even when a hand-edited `config.yml` cannot be parsed.
      logger?.warn(`Skipping the Rovo Dev mcp.disabledMcpServers update: ${formatError(error)}`);
      return [];
    }

    const existingMcp = isRecord(existingParsed.mcp) ? { ...existingParsed.mcp } : {};
    const existingDisabled = isStringArray(existingMcp.disabledMcpServers)
      ? existingMcp.disabledMcpServers
      : [];
    // rulesync owns the toggle for the servers it manages; names it does not
    // manage keep their existing state. Because removal flips an off-switch,
    // a managed name that was disabled on disk but is enabled canonically is
    // called out rather than silently re-enabled.
    const managedNameSet = new Set(managedNames);
    const reEnabled = existingDisabled.filter(
      (name) => managedNameSet.has(name) && !disabledNames.includes(name),
    );
    if (reEnabled.length > 0) {
      logger?.warn(
        `Rovo Dev MCP: re-enabling ${reEnabled.join(", ")} — the canonical config does not mark ` +
          `${reEnabled.length === 1 ? "it" : "them"} disabled. Set "disabled": true in ` +
          `.rulesync/mcp.jsonc to keep a managed server off.`,
      );
    }
    const mergedDisabled = [
      ...existingDisabled.filter((name) => !managedNameSet.has(name)),
      ...disabledNames,
    ].toSorted();

    if (mergedDisabled.length > 0) {
      existingMcp.disabledMcpServers = mergedDisabled;
    } else {
      delete existingMcp.disabledMcpServers;
    }
    // Nothing to write and nothing to clean up: do not create or touch the
    // shared config just to hold an empty block.
    if (mergedDisabled.length === 0 && existingContent.trim() === "") {
      return [];
    }

    const fileContent = applySharedConfigPatch({
      fileKey: ROVODEV_CONFIG_SHARED_FILE_KEY,
      feature: "mcp",
      existingContent,
      patch: { mcp: Object.keys(existingMcp).length > 0 ? existingMcp : undefined },
      filePath: join(ROVODEV_DIR, ROVODEV_CONFIG_FILE_NAME),
    });

    return [
      new RovodevMcpConfigYaml({
        outputRoot,
        relativeDirPath: ROVODEV_DIR,
        relativeFilePath: ROVODEV_CONFIG_FILE_NAME,
        fileContent,
        global,
      }),
    ];
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
