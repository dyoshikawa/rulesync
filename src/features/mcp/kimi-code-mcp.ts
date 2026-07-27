import { join } from "node:path";

import {
  KIMI_CODE_CONFIG_FILE_NAME,
  KIMI_CODE_MCP_FILE_NAME,
} from "../../constants/kimi-code-paths.js";
import {
  RULESYNC_MCP_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  getKimiCodeRelativeDirPath,
  getKimiCodeRulesyncOutputRoot,
} from "../../utils/kimi-code.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  KIMI_CODE_CONFIG_SHARED_FILE_KEY,
  parseSharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  type ToolMcpForDeletionParams,
  type ToolMcpFromFileParams,
  type ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  type ToolMcpSettablePaths,
} from "./tool-mcp.js";

function normalizeKimiCodeTransport({
  transport,
  hasCommand,
}: {
  transport: unknown;
  hasCommand: boolean;
}): "stdio" | "http" | "sse" {
  if (transport === "local" || transport === "stdio") {
    return "stdio";
  }
  if (transport === "sse") {
    return "sse";
  }
  if (transport === "http" || transport === "streamable-http") {
    return "http";
  }
  return hasCommand ? "stdio" : "http";
}

function toKimiCodeServer({
  name,
  server,
  logger,
}: {
  name: string;
  server: McpServers[string];
  logger?: Logger;
}): Record<string, unknown> | null {
  const transport = server.transport ?? server.type;
  if (transport === "ws") {
    logger?.warn(`Kimi Code MCP: skipping "${name}" because WebSocket transport is unsupported.`);
    return null;
  }

  const command = server.command;
  const normalizedCommand = Array.isArray(command) ? command[0] : command;
  const commandArgs = Array.isArray(command) ? command.slice(1) : [];
  const args = [...commandArgs, ...(server.args ?? [])];
  const url = server.httpUrl ?? server.url;
  const normalizedTransport = normalizeKimiCodeTransport({
    transport,
    hasCommand: normalizedCommand !== undefined,
  });
  if (
    (normalizedTransport === "stdio" && !normalizedCommand) ||
    (normalizedTransport !== "stdio" && !url)
  ) {
    logger?.warn(
      `Kimi Code MCP: skipping "${name}" because its ${normalizedTransport} configuration is incomplete.`,
    );
    return null;
  }

  const converted: Record<string, unknown> = {
    transport: normalizedTransport,
    ...(normalizedCommand && { command: normalizedCommand }),
    ...(args.length > 0 && { args }),
    ...(url && { url }),
  };
  for (const field of [
    "env",
    "cwd",
    "headers",
    "bearerTokenEnvVar",
    "enabled",
    "startupTimeoutMs",
    "toolTimeoutMs",
    "enabledTools",
    "disabledTools",
  ]) {
    if (server[field] !== undefined) {
      converted[field] = server[field];
    }
  }
  if (server.disabled === true) {
    converted.enabled = false;
  }
  return converted;
}

function toKimiCodeServers({
  servers,
  logger,
}: {
  servers: McpServers;
  logger?: Logger;
}): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};
  for (const [name, server] of Object.entries(servers)) {
    const converted = toKimiCodeServer({ name, server, logger });
    if (converted) {
      result[name] = converted;
    }
  }
  return result;
}

function fromKimiCodeServers(servers: McpServers): McpServers {
  return Object.fromEntries(
    Object.entries(servers).map(([name, server]) => {
      const { transport, enabled, ...rest } = server;
      const type =
        transport === "stdio" || transport === "sse" || transport === "http"
          ? transport
          : undefined;
      return [
        name,
        {
          ...rest,
          ...(type && { type }),
          ...(enabled === false && { disabled: true }),
        },
      ];
    }),
  );
}

/**
 * Kimi Code MCP configuration.
 *
 * Both project and user scope use `.kimi-code/mcp.json`, resolved against the
 * project root or home directory respectively.
 *
 * @see https://moonshotai.github.io/kimi-code/en/customization/mcp.html
 */

/** Kimi's `[mcp]` global defaults, in rulesync's camelCase spelling. */
export type KimiCodeMcpDefaults = {
  startupTimeoutMs?: number;
  toolTimeoutMs?: number;
};

type KimiCodeMcpExtraParams = {
  configDefaults?: KimiCodeMcpDefaults;
};

/** Path of the shared user `config.toml`, relative to the output root. */
function kimiCodeConfigRelativePath(): { relativeDirPath: string; relativeFilePath: string } {
  return {
    relativeDirPath: getKimiCodeRelativeDirPath({ global: true }),
    relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
  };
}

type KimiCodeConfigRead =
  | { readonly parsed: true; readonly content: string; readonly mcp: Record<string, unknown> }
  | { readonly parsed: false; readonly content: string };

/**
 * Read the shared user `config.toml` once and report whether it parsed. Both
 * the generate and import paths need the raw content *and* the `[mcp]` table,
 * and they must agree about a file that does not parse — reading it twice with
 * different error policies is what let a hand-broken config abort work that had
 * nothing to do with it.
 */
async function readKimiCodeConfig({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<KimiCodeConfigRead> {
  const paths = kimiCodeConfigRelativePath();
  const content =
    (await readFileContentOrNull(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    )) ?? "";
  try {
    const mcp = parseSharedConfig({ format: "toml", fileContent: content }).mcp;
    return { parsed: true, content, mcp: isRecord(mcp) ? mcp : {} };
  } catch {
    return { parsed: false, content };
  }
}

/**
 * Read the `[mcp]` defaults back out of the shared user `config.toml` so a
 * generate → import round trip keeps them. Absent or unparseable content yields
 * no defaults rather than failing the import: this file belongs to three
 * features plus the user.
 */
async function readKimiCodeMcpDefaults({
  outputRoot,
}: {
  outputRoot: string;
}): Promise<KimiCodeMcpDefaults> {
  const config = await readKimiCodeConfig({ outputRoot });
  if (!config.parsed) {
    return {};
  }
  return {
    ...(typeof config.mcp.startup_timeout_ms === "number" && {
      startupTimeoutMs: config.mcp.startup_timeout_ms,
    }),
    ...(typeof config.mcp.tool_timeout_ms === "number" && {
      toolTimeoutMs: config.mcp.tool_timeout_ms,
    }),
  };
}

/**
 * Kimi's `[mcp]` section in the shared user config sets the default connect and
 * per-tool-call timeouts for *every* MCP server, including ones rulesync did not
 * write. Per-server values in `mcp.json` still take precedence; this only moves
 * the floor.
 *
 * Written as an auxiliary file so it goes through the normal write phase and
 * respects `--dry-run`, and merged through the shared-config gateway so the
 * `hooks` and `permissions` sections of the same `config.toml` survive.
 *
 * The gateway replaces an owned key wholesale, and `mcp` is a table, so the
 * section is recomputed from the existing file: authoring only
 * `startupTimeoutMs` must not delete a hand-written `tool_timeout_ms`. Same
 * approach the `.vibe/config.toml` `tools` writer takes.
 *
 * @see https://moonshotai.github.io/kimi-code/en/configuration/config-files.html#mcp
 */
export class KimiCodeMcpConfigToml extends ToolFile {
  override isDeletable(): boolean {
    // Shared with the hooks and permissions features, and with the user's own
    // settings; only the `mcp` key is rulesync-managed.
    return false;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static fromDefaults({
    outputRoot,
    defaults,
    existing,
  }: {
    outputRoot: string;
    defaults: KimiCodeMcpDefaults;
    existing: Extract<KimiCodeConfigRead, { parsed: true }>;
  }): KimiCodeMcpConfigToml {
    const paths = kimiCodeConfigRelativePath();
    const relativeConfigPath = join(paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = existing.content;
    const existingSection = existing.mcp;
    const fileContent = applySharedConfigPatch({
      fileKey: KIMI_CODE_CONFIG_SHARED_FILE_KEY,
      feature: "mcp",
      existingContent,
      patch: {
        mcp: {
          ...existingSection,
          ...(defaults.startupTimeoutMs !== undefined && {
            startup_timeout_ms: defaults.startupTimeoutMs,
          }),
          ...(defaults.toolTimeoutMs !== undefined && {
            tool_timeout_ms: defaults.toolTimeoutMs,
          }),
        },
      },
      // Relative, matching the hooks and permissions writers of the same file,
      // so an error message does not leak the user's home path.
      filePath: relativeConfigPath,
    });

    return new KimiCodeMcpConfigToml({
      outputRoot,
      ...paths,
      fileContent,
    });
  }
}

export class KimiCodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;
  /**
   * `[mcp]` defaults read from the shared user `config.toml`. Held on the
   * instance because `toRulesyncMcp` is synchronous, while the defaults live in
   * a different file that only the async `fromFile` can read.
   */
  private readonly configDefaults: { startupTimeoutMs?: number; toolTimeoutMs?: number };

  constructor(params: ToolMcpParams & KimiCodeMcpExtraParams) {
    super(params);
    this.configDefaults = params.configDefaults ?? {};
    try {
      this.json = this.fileContent ? JSON.parse(this.fileContent) : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Kimi Code MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: getKimiCodeRelativeDirPath({ global }),
      relativeFilePath: KIMI_CODE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KimiCodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
      configDefaults: global ? await readKimiCodeMcpDefaults({ outputRoot }) : {},
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<KimiCodeMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let existing: Record<string, unknown>;
    try {
      existing = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Kimi Code MCP config at ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }

    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(
        {
          ...existing,
          mcpServers: toKimiCodeServers({
            servers: rulesyncMcp.getMcpServers(),
            logger,
          }),
        },
        null,
        2,
      ),
      validate,
      global,
    });
  }

  /**
   * The `[mcp]` defaults reach the shared user `config.toml`, which the hooks
   * and permissions features also write. Declared here so the write-order
   * derivation sees this feature as one of that file's writers — it is not a
   * settable path, since the servers themselves live in `mcp.json`.
   */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    return global
      ? [
          {
            relativeDirPath: getKimiCodeRelativeDirPath({ global: true }),
            relativeFilePath: KIMI_CODE_CONFIG_FILE_NAME,
          },
        ]
      : [];
  }

  /**
   * The `[mcp]` defaults live in the shared user `config.toml`, not in
   * `mcp.json`, so they are emitted as an auxiliary file. Global scope only:
   * `config.toml` has no project counterpart.
   */
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
    if (!global) {
      return [];
    }
    const block = (rulesyncMcp.getJson() as Record<string, unknown>)["kimi-code"];
    if (!isRecord(block)) {
      return [];
    }
    const startupTimeoutMs =
      typeof block.startupTimeoutMs === "number" ? block.startupTimeoutMs : undefined;
    const toolTimeoutMs = typeof block.toolTimeoutMs === "number" ? block.toolTimeoutMs : undefined;
    if (startupTimeoutMs === undefined && toolTimeoutMs === undefined) {
      return [];
    }

    const existing = await readKimiCodeConfig({ outputRoot });
    if (!existing.parsed) {
      // Skip only this file. The servers in `mcp.json` have nothing to do with
      // `config.toml`, so a hand-broken config must not stop them being written.
      const paths = kimiCodeConfigRelativePath();
      warnWithFallback(
        logger,
        `Skipping the Kimi Code MCP timeout defaults: ${join(paths.relativeDirPath, paths.relativeFilePath)} is not valid TOML.`,
      );
      return [];
    }

    return [
      KimiCodeMcpConfigToml.fromDefaults({
        outputRoot,
        defaults: { startupTimeoutMs, toolTimeoutMs },
        existing,
      }),
    ];
  }

  toRulesyncMcp(): RulesyncMcp {
    return new RulesyncMcp({
      outputRoot: getKimiCodeRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_MCP_FILE_NAME,
      fileContent: JSON.stringify(
        {
          ...this.json,
          mcpServers: fromKimiCodeServers(
            isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {},
          ),
          ...(Object.keys(this.configDefaults).length > 0 && {
            "kimi-code": this.configDefaults,
          }),
        },
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
  }: ToolMcpForDeletionParams): KimiCodeMcp {
    return new KimiCodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
