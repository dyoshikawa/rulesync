import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { refine, z } from "zod/mini";

import {
  KILO_DIR,
  KILO_GLOBAL_DIR,
  KILO_JSON_FILE_NAME,
  KILO_JSONC_FILE_NAME,
} from "../../constants/kilo-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Kilo MCP server schemas
// Kilo uses "local"/"remote" instead of "stdio"/"sse"/"http",
// "environment" instead of "env", and "enabled" instead of "disabled"

// Kilo OAuth config for remote servers.
// Per https://app.kilo.ai/config.json the `oauth` field is either an
// `McpOAuthConfig` object (clientId/clientSecret/scope/callbackPort/redirectUri)
// or the literal `false` to disable auto-detection. Modeled permissively with a
// looseObject so future fields round-trip unchanged.
const KiloMcpOAuthSchema = z.union([z.looseObject({}), z.literal(false)]);

// Kilo native format for local servers
const KiloMcpLocalServerSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()),
  environment: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
  cwd: z.optional(z.string()),
  // Kilo documents `timeout` as a positive integer (milliseconds), but rulesync
  // preserves whatever value is already present so existing kilo.jsonc files
  // round-trip losslessly without the constructor's mandatory parse throwing.
  timeout: z.optional(z.number()),
});

// Kilo native format for remote servers
const KiloMcpRemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string(),
  headers: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
  // See the local schema: documented as a positive integer (milliseconds), but
  // preserved as-is for lossless round-trip.
  timeout: z.optional(z.number()),
  oauth: z.optional(KiloMcpOAuthSchema),
});

/**
 * A bare toggle entry: `{"enabled": <bool>}` with no transport of its own,
 * disabling a server another config layer defines — the global config, a
 * marketplace, or a VS Code import. Kilo's own type is
 * `Record<string, Info | { enabled: boolean }>`; without this arm the union
 * rejects the entry and, because `kilo.jsonc` is the file the rules feature
 * writes too, the whole `--targets kilo` run aborts rather than just MCP.
 *
 * Loose like every other schema here, so an unknown key on a toggle does not
 * bring that abort back — but refined to reject anything carrying a transport
 * key. A plain loose arm would sit under a malformed `local` or `remote` entry
 * that happens to carry `enabled` and swallow it, dropping its command or URL
 * without a word instead of failing the way it does today.
 * @see https://github.com/Kilo-Org/kilocode/blob/main/packages/core/src/v1/config/config.ts
 */
const KILO_MCP_TRANSPORT_KEYS = ["type", "command", "url"] as const;

const KiloMcpToggleSchema = z
  .looseObject({
    enabled: z.boolean(),
  })
  .check(
    refine(
      (entry) => KILO_MCP_TRANSPORT_KEYS.every((key) => !(key in entry)),
      "a bare MCP toggle entry must not carry a transport",
    ),
  );

// Kilo MCP server schema (local, remote, or a toggle for a server defined elsewhere)
const KiloMcpServerSchema = z.union([
  KiloMcpLocalServerSchema,
  KiloMcpRemoteServerSchema,
  KiloMcpToggleSchema,
]);

// Use looseObject to allow additional properties like model, provider, agent,
// etc.
const KiloConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  mcp: z.optional(z.record(z.string(), KiloMcpServerSchema)),
  tools: z.optional(z.record(z.string(), z.boolean())),
  // Project rule files/globs that Kilo auto-loads. Shared with the rules
  // feature (see kilo-rule.ts); preserved here so writing MCP never drops it.
  instructions: z.optional(z.array(z.string())),
  // Extra skill locations and remote skill manifest URLs configurable in
  // `kilo.jsonc`. Preserved here so writing MCP never drops them.
  // https://kilo.ai/docs/customize/skills
  skills: z.optional(
    z.looseObject({
      paths: z.optional(z.array(z.string())),
      urls: z.optional(z.array(z.string())),
    }),
  ),
});

type KiloConfig = z.infer<typeof KiloConfigSchema>;
type KiloMcpServer = z.infer<typeof KiloMcpServerSchema>;
type KiloMcpTransportServer =
  | z.infer<typeof KiloMcpLocalServerSchema>
  | z.infer<typeof KiloMcpRemoteServerSchema>;

/**
 * Tell the two transport arms from a toggle entry. Both carry a `type` literal
 * and a toggle never does — the schema refuses one that tries — but the toggle
 * arm is loose, so its index signature hides that from `in` narrowing.
 */
function isKiloTransportServer(server: KiloMcpServer): server is KiloMcpTransportServer {
  return server.type === "local" || server.type === "remote";
}

/** Split the shared top-level `tools` map into this server's own two lists. */
function splitKiloServerTools(
  serverName: string,
  tools: Record<string, boolean> | undefined,
): { enabledTools: string[]; disabledTools: string[] } {
  const enabledTools: string[] = [];
  const disabledTools: string[] = [];
  const prefix = `${serverName}_`;

  for (const [toolName, enabled] of Object.entries(tools ?? {})) {
    if (!toolName.startsWith(prefix)) {
      continue;
    }
    const toolSuffix = toolName.slice(prefix.length);
    (enabled ? enabledTools : disabledTools).push(toolSuffix);
  }
  return { enabledTools, disabledTools };
}

function kiloServerToRulesync(
  serverName: string,
  server: KiloMcpServer,
  { enabledTools, disabledTools }: { enabledTools: string[]; disabledTools: string[] },
): McpServers[string] {
  // Everything but `timeout`, which only the two transport arms carry — reading
  // it here would defeat the narrowing below and force a cast.
  const shared = {
    ...(server.enabled === false && { disabled: true }),
    ...(enabledTools.length > 0 && { enabledTools }),
    ...(disabledTools.length > 0 && { disabledTools }),
  };

  if (!isKiloTransportServer(server)) {
    // A toggle entry names a server another config layer defines, so there is
    // no transport to import — only its disabled state crosses over. Writing it
    // back keeps that layer switched off.
    return shared;
  }

  const withTimeout = {
    ...shared,
    ...(server.timeout !== undefined && { timeout: server.timeout }),
  };

  if (server.type === "remote") {
    return {
      // Kilo's `remote` transport is transport-agnostic; SSE is deprecated by
      // the MCP spec (2025-03-26) in favor of Streamable HTTP, so import as
      // `http` rather than the legacy `sse`.
      type: "http" as const,
      url: server.url,
      ...(server.headers && { headers: server.headers }),
      ...(server.oauth !== undefined && { oauth: server.oauth }),
      ...withTimeout,
    };
  }

  const [command, ...args] = server.command;
  if (!command) {
    throw new Error(`Server "${serverName}" has an empty command array`);
  }
  return {
    type: "stdio" as const,
    command,
    ...(args.length > 0 && { args }),
    ...(server.environment && { env: server.environment }),
    ...(server.cwd && { cwd: server.cwd }),
    ...withTimeout,
  };
}

/**
 * Convert Kilo native format back to standard MCP format
 * - type: "local" -> "stdio", "remote" -> "http"
 * - command (array) -> command (first element) + args (rest)
 * - environment -> env
 * - enabled -> disabled (inverted)
 * - top-level tools map -> per-server enabledTools/disabledTools (strip server prefix)
 */
function convertFromKiloFormat(
  kiloMcp: Record<string, KiloMcpServer>,
  tools?: Record<string, boolean>,
): McpServers {
  return Object.fromEntries(
    Object.entries(kiloMcp).map(([serverName, serverConfig]) => [
      serverName,
      kiloServerToRulesync(serverName, serverConfig, splitKiloServerTools(serverName, tools)),
    ]),
  );
}

/**
 * Convert standard MCP format to Kilo native format
 * - type: "stdio" -> "local", "sse"/"http" -> "remote"
 * - command + args -> command (merged array)
 * - env -> environment
 * - disabled -> enabled (inverted)
 * - enabledTools/disabledTools -> top-level tools map (with server name prefix)
 */
type McpServerConfig = McpServers[string];

/**
 * Collect a server's enabledTools/disabledTools into the shared top-level tools
 * map, prefixing each tool name with the server name. Mutates `tools` in place.
 */
function collectKiloServerTools(
  tools: Record<string, boolean>,
  serverName: string,
  serverConfig: McpServerConfig,
): void {
  if (serverConfig.enabledTools) {
    for (const tool of serverConfig.enabledTools) {
      tools[`${serverName}_${tool}`] = true;
    }
  }
  if (serverConfig.disabledTools) {
    for (const tool of serverConfig.disabledTools) {
      tools[`${serverName}_${tool}`] = false;
    }
  }
}

/**
 * No transport of any kind: the server came from a Kilo toggle entry, which
 * names a server another config layer defines. Writing it back as
 * `{type: "local", command: []}` would shadow that definition with one that
 * cannot start, so it goes back out as the toggle it was.
 */
function hasNoTransport(serverConfig: McpServerConfig): boolean {
  return (
    serverConfig.type === undefined &&
    serverConfig.transport === undefined &&
    serverConfig.command === undefined &&
    serverConfig.url === undefined &&
    serverConfig.httpUrl === undefined
  );
}

/** The only fields a bare toggle carries over; everything else needs a transport. */
const KILO_TOGGLE_KEPT_KEYS = new Set(["disabled", "enabledTools", "disabledTools"]);

/**
 * A toggle keeps nothing but its enabled state, so a transport-less server that
 * still carries `args`, `env`, or `headers` loses them here. Such an entry is
 * impossible to start — no command, no URL — so it is written as the toggle it
 * resembles rather than dropped, but the loss is said out loud.
 */
function warnAboutToggleDroppedKeys(
  serverName: string,
  serverConfig: McpServerConfig,
  logger?: Logger,
): void {
  const dropped = Object.keys(serverConfig).filter((key) => !KILO_TOGGLE_KEPT_KEYS.has(key));
  if (dropped.length === 0) {
    return;
  }
  logger?.warn(
    `Kilo MCP: "${serverName}" declares no transport, so it is written as a toggle entry and ` +
      `${dropped.toSorted().join(", ")} ${dropped.length === 1 ? "is" : "are"} dropped.`,
  );
}

/**
 * Convert a single rulesync MCP server into its Kilo native form (local, remote,
 * or a bare toggle for a server another config layer defines).
 */
function convertServerToKiloFormat(
  serverName: string,
  serverConfig: McpServerConfig,
  logger?: Logger,
): KiloMcpServer {
  if (hasNoTransport(serverConfig)) {
    warnAboutToggleDroppedKeys(serverName, serverConfig, logger);
    return { enabled: serverConfig.disabled !== true };
  }

  // `httpUrl` counts as a transport here as much as it does in `hasNoTransport`
  // — a server carrying only that (the shape the Gemini CLI adapter imports)
  // would otherwise be written as a local server with an empty command, which
  // Kilo cannot start and this adapter cannot read back.
  const isRemote =
    serverConfig.type === "sse" ||
    serverConfig.type === "http" ||
    serverConfig.url !== undefined ||
    serverConfig.httpUrl !== undefined;

  if (isRemote) {
    // `oauth` is Kilo-specific (object | false) and carried through via the
    // rulesync MCP server's looseObject passthrough; it is not a declared
    // field on McpServerSchema.
    const oauth = (serverConfig as { oauth?: unknown }).oauth;
    return {
      type: "remote",
      url: serverConfig.url ?? serverConfig.httpUrl ?? "",
      enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
      ...(serverConfig.headers && { headers: serverConfig.headers }),
      ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
      ...(oauth !== undefined && { oauth: oauth as z.infer<typeof KiloMcpOAuthSchema> }),
    };
  }

  // Build command array: merge command and args
  const commandArray: string[] = [];
  if (serverConfig.command) {
    if (Array.isArray(serverConfig.command)) {
      commandArray.push(...serverConfig.command);
    } else {
      commandArray.push(serverConfig.command);
    }
  }
  if (serverConfig.args) {
    commandArray.push(...serverConfig.args);
  }

  return {
    type: "local",
    command: commandArray,
    enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
    ...(serverConfig.env && { environment: serverConfig.env }),
    ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
    ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
  };
}

function convertToKiloFormat(
  mcpServers: McpServers,
  logger?: Logger,
): {
  mcp: Record<string, KiloMcpServer>;
  tools: Record<string, boolean>;
} {
  const tools: Record<string, boolean> = {};

  const mcp = Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      collectKiloServerTools(tools, serverName, serverConfig);
      return [serverName, convertServerToKiloFormat(serverName, serverConfig, logger)];
    }),
  );

  return { mcp, tools };
}

export class KiloMcp extends ToolMcp {
  private readonly json: KiloConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = KiloConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): KiloConfig {
    return this.json;
  }

  /**
   * kilo.json may contain other settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: KILO_GLOBAL_DIR,
        relativeFilePath: KILO_JSON_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: KILO_JSON_FILE_NAME,
    };
  }

  /**
   * Resolve the config file to import from, probing in priority order:
   *   1. project root `kilo.jsonc` / `kilo.json` (or the global `.config/kilo`
   *      directory in global mode), then
   *   2. the alternative project location `.kilo/kilo.jsonc` / `.kilo/kilo.json`.
   *
   * Kilo accepts project config at the root OR under `.kilo/` ("for a cleaner
   * setup"), so the import side probes both. The write side intentionally stays
   * at the root location returned by `getSettablePaths`.
   * https://kilo.ai/docs/automate/mcp/using-in-kilo-code
   */
  private static async resolveImportConfig({
    outputRoot,
    global,
  }: {
    outputRoot: string;
    global: boolean;
  }): Promise<{ fileContent: string | null; relativeDirPath: string; relativeFilePath: string }> {
    const rootDirPath = this.getSettablePaths({ global }).relativeDirPath;
    // The alternative `.kilo/` project location only applies to project scope.
    const candidateDirPaths = global ? [rootDirPath] : [rootDirPath, KILO_DIR];

    // Track the first existing-but-empty file so the empty-content path is
    // preserved (an existing empty `kilo.json` should be parsed as-is, matching
    // the previous root-only behavior, rather than silently defaulting to an
    // empty `mcp` object).
    let emptyFallback: { relativeDirPath: string; relativeFilePath: string } | null = null;

    for (const relativeDirPath of candidateDirPaths) {
      const jsonDir = join(outputRoot, relativeDirPath);

      // Always try JSONC first (preferred format), then fall back to JSON.
      for (const relativeFilePath of [KILO_JSONC_FILE_NAME, KILO_JSON_FILE_NAME]) {
        const content = await readFileContentOrNull(join(jsonDir, relativeFilePath));
        if (content === null) {
          continue;
        }
        if (content) {
          return { fileContent: content, relativeDirPath, relativeFilePath };
        }
        // Existing but empty file: remember the first one as a fallback.
        emptyFallback ??= { relativeDirPath, relativeFilePath };
      }
    }

    if (emptyFallback) {
      return {
        fileContent: "",
        relativeDirPath: emptyFallback.relativeDirPath,
        relativeFilePath: emptyFallback.relativeFilePath,
      };
    }

    return {
      fileContent: null,
      relativeDirPath: rootDirPath,
      relativeFilePath: KILO_JSONC_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KiloMcp> {
    const { fileContent, relativeDirPath, relativeFilePath } = await this.resolveImportConfig({
      outputRoot,
      global,
    });

    const fileContentToUse = fileContent ?? '{"mcp":{}}';
    const json = parseJsonc(fileContentToUse);
    const newJson = { ...json, mcp: json.mcp ?? {} };

    return new KiloMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<KiloMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = KILO_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, KILO_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, KILO_JSON_FILE_NAME);

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = KILO_JSON_FILE_NAME;
      }
    }

    const { mcp: convertedMcp, tools: mcpTools } = convertToKiloFormat(
      rulesyncMcp.getMcpServers(),
      logger,
    );

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      // Keyed by the base settable paths: a resolved `.jsonc` twin shares the
      // `.json` ownership declaration. `tools` is retracted when the generated
      // servers carry no tool filters.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "mcp",
        existingContent: fileContent ?? "",
        patch: {
          mcp: convertedMcp,
          tools: Object.keys(mcpTools).length > 0 ? mcpTools : undefined,
        },
        filePath: join(jsonDir, relativeFilePath),
      }),
      validate,
    });
  }

  /**
   * Merge a list of project rule file globs into the `instructions` array of the
   * shared `kilo.jsonc` (or `kilo.json`) config, preserving every existing key
   * (notably `mcp`/`tools` written by the MCP feature). In Kilo v7, files under
   * `.kilo/rules/` are NOT auto-loaded; they are only picked up when listed in
   * the `instructions` key. The resulting `instructions` list is deduped and
   * sorted for a stable output.
   *
   * @see https://kilo.ai/docs/automate/mcp/using-in-kilo-code
   */
  static async fromInstructions({
    outputRoot = process.cwd(),
    instructions,
    validate = true,
    global = false,
  }: {
    outputRoot?: string;
    instructions: string[];
    validate?: boolean;
    global?: boolean;
  }): Promise<KiloMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = KILO_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, KILO_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, KILO_JSON_FILE_NAME);

    // Prefer kilo.jsonc, fall back to kilo.json, mirroring fromRulesyncMcp.
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = KILO_JSON_FILE_NAME;
      }
    }

    const json = fileContent ? parseJsonc(fileContent) : {};
    const existingInstructions: string[] = Array.isArray(json.instructions)
      ? json.instructions.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];

    const mergedInstructions = Array.from(
      new Set([...existingInstructions, ...instructions]),
    ).toSorted();

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "rules",
        existingContent: fileContent ?? "",
        patch: { instructions: mergedInstructions },
        filePath: join(jsonDir, relativeFilePath),
      }),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const convertedMcpServers = convertFromKiloFormat(this.json.mcp ?? {}, this.json.tools);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: convertedMcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    // Parse fileContent directly since this.json may not be initialized yet
    // when validate() is called from parent constructor
    const json = JSON.parse(this.fileContent || "{}");
    const result = KiloConfigSchema.safeParse(json);
    if (!result.success) {
      return { success: false, error: result.error };
    }
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): KiloMcp {
    return new KiloMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
