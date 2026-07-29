import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { refine, z } from "zod/mini";

import {
  OPENCODE_GLOBAL_DIR,
  OPENCODE_JSON_FILE_NAME,
  OPENCODE_JSONC_FILE_NAME,
} from "../../constants/opencode-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import {
  convertEnvVarRefsFromToolFormat,
  convertEnvVarRefsToToolFormat,
} from "./mcp-env-var-format.js";
import {
  declaresNoTransport,
  isRemoteMcpServer,
  type McpServerConfig,
  orphanMcpToolFiltersToRulesync,
  resolveLocalMcpCommand,
  resolveRemoteMcpUrl,
  splitMcpServersByTransport,
  warnAndSkipMcpServer,
} from "./mcp-transport.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// Negative lookbehind avoids matching Cursor's ${env:VAR} format
const OPENCODE_ENV_VAR_PATTERN = /(?<!\$)\{env:([^}:]+)\}/g;

// OpenCode MCP server schemas
// OpenCode uses "local"/"remote" instead of "stdio"/"sse"/"http",
// "environment" instead of "env", and "enabled" instead of "disabled"

// OpenCode native format for local servers.
// looseObject preserves documented-but-unmodeled per-server fields (e.g. `timeout`)
// and future additions on round-trip, matching the project's frequently-changing
// tool-config convention. https://opencode.ai/docs/mcp-servers
const OpencodeMcpLocalServerSchema = z.looseObject({
  type: z.literal("local"),
  command: z.array(z.string()),
  environment: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
  cwd: z.optional(z.string()),
});

// OpenCode native format for remote servers.
// looseObject preserves documented-but-unmodeled per-server fields (e.g. `timeout`,
// `oauth`) and future additions on round-trip. https://opencode.ai/docs/mcp-servers
const OpencodeMcpRemoteServerSchema = z.looseObject({
  type: z.literal("remote"),
  url: z.string(),
  headers: z.optional(z.record(z.string(), z.string())),
  enabled: z._default(z.boolean(), true),
});

// Every field of the two transport schemas except `enabled`, which is what a
// toggle entry carries.
const OPENCODE_MCP_TRANSPORT_KEYS = [
  ...Object.keys(OpencodeMcpLocalServerSchema.def.shape),
  ...Object.keys(OpencodeMcpRemoteServerSchema.def.shape),
].filter((key) => key !== "enabled");

/**
 * A bare toggle entry: `{"enabled": <bool>}` with no transport of its own,
 * disabling a server another config layer defines. It is the third member of
 * OpenCode's own `mcp` union in the published schema, described in-source as
 * "the legacy `{ enabled: false }` form used to disable a server". Without this
 * arm the union rejects the entry and the whole MCP import aborts — taking
 * every valid server in the same file down with it.
 *
 * Loose, unlike the two transport arms, so a key OpenCode adds to a toggle
 * later does not bring that abort back — but refined to reject anything
 * carrying a key only a transport entry has. A plain loose arm would sit under
 * a malformed `local` or `remote` entry that happens to carry `enabled` and
 * swallow it, dropping its command, URL, or headers without a word instead of
 * failing the way it does today. Mirrors {@link KiloMcpToggleSchema}.
 *
 * @see https://opencode.ai/config.json
 */
const OpencodeMcpToggleSchema = z
  .looseObject({
    enabled: z.boolean(),
  })
  .check(
    refine(
      (entry) => OPENCODE_MCP_TRANSPORT_KEYS.every((key) => !(key in entry)),
      'not a valid OpenCode MCP server: expected a local server ({type: "local", command: [...]}), ' +
        'a remote server ({type: "remote", url: "..."}), or a bare toggle ({enabled: <bool>}) ' +
        "carrying no field of either",
    ),
  );

// OpenCode MCP server schema (local, remote, or a toggle for a server defined elsewhere)
const OpencodeMcpServerSchema = z.union([
  OpencodeMcpLocalServerSchema,
  OpencodeMcpRemoteServerSchema,
  OpencodeMcpToggleSchema,
]);

// Use looseObject to allow additional properties like model, provider, agent,
// etc.
const OpencodeConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  mcp: z.optional(z.record(z.string(), OpencodeMcpServerSchema)),
  tools: z.optional(z.record(z.string(), z.boolean())),
});

type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;
type OpencodeMcpServer = z.infer<typeof OpencodeMcpServerSchema>;
type OpencodeMcpTransportServer =
  | z.infer<typeof OpencodeMcpLocalServerSchema>
  | z.infer<typeof OpencodeMcpRemoteServerSchema>;

/**
 * Tell the two transport arms from a toggle entry. Both carry a `type` literal
 * and a toggle never does — the schema refuses one that tries — but the toggle
 * arm is loose, so its index signature hides that from `in` narrowing.
 */
export function isOpencodeTransportServer(
  server: OpencodeMcpServer,
): server is OpencodeMcpTransportServer {
  return server.type === "local" || server.type === "remote";
}

/**
 * Convert OpenCode native format back to standard MCP format
 * - type: "local" -> "stdio", "remote" -> "sse"
 * - command (array) -> command (first element) + args (rest)
 * - environment -> env
 * - enabled -> disabled (inverted)
 * - top-level tools map -> per-server enabledTools/disabledTools (strip server prefix)
 */
// OpenCode per-server keys that this converter transforms explicitly. Any other
// key (e.g. `timeout`, `oauth`, future additions) is passed through verbatim so it
// survives import — see https://opencode.ai/docs/mcp-servers
//
// `enabledTools`/`disabledTools` are also listed here: although OpenCode encodes
// them in the top-level `tools` map (not on the server object), including them
// guards against a stray same-named key on an OpenCode server object being passed
// through as an "extra" field and colliding with the values this converter derives
// from the `tools` map.
const OPENCODE_KNOWN_SERVER_KEYS = new Set([
  "type",
  "command",
  "environment",
  "enabled",
  "cwd",
  "url",
  "headers",
  "enabledTools",
  "disabledTools",
]);

function convertFromOpencodeFormat(
  opencodeMcp: Record<string, OpencodeMcpServer>,
  tools?: Record<string, boolean>,
): McpServers {
  return {
    ...orphanMcpToolFiltersToRulesync(opencodeMcp, tools),
    ...convertOpencodeServers(opencodeMcp, tools),
  };
}

/** Split the shared top-level `tools` map into this server's own two lists. */
function splitOpencodeServerTools(
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

function convertOpencodeServers(
  opencodeMcp: Record<string, OpencodeMcpServer>,
  tools?: Record<string, boolean>,
): McpServers {
  return Object.fromEntries(
    Object.entries(opencodeMcp).map(([serverName, serverConfig]) => {
      // Preserve documented-but-unmodeled fields (e.g. `timeout`, `oauth`) on import.
      const extraFields = Object.fromEntries(
        Object.entries(serverConfig).filter(([key]) => !OPENCODE_KNOWN_SERVER_KEYS.has(key)),
      );

      const { enabledTools, disabledTools } = splitOpencodeServerTools(serverName, tools);

      if (!isOpencodeTransportServer(serverConfig)) {
        // A toggle entry names a server another config layer defines, so there
        // is no transport to import — only its enabled state crosses over. The
        // write side then skips it, exactly as it does a transport-less server.
        return [
          serverName,
          {
            ...extraFields,
            disabled: serverConfig.enabled === false,
            ...(enabledTools.length > 0 && { enabledTools }),
            ...(disabledTools.length > 0 && { disabledTools }),
          },
        ];
      }

      if (serverConfig.type === "remote") {
        return [
          serverName,
          {
            // Spread extras first so converter-derived fields below always win
            // on any key collision.
            ...extraFields,
            type: "sse" as const,
            url: serverConfig.url,
            ...(serverConfig.enabled === false && { disabled: true }),
            ...(serverConfig.headers && { headers: serverConfig.headers }),
            ...(enabledTools.length > 0 && { enabledTools }),
            ...(disabledTools.length > 0 && { disabledTools }),
          },
        ];
      }

      // local server -> stdio
      const [command, ...args] = serverConfig.command;
      if (!command) {
        // `{type: "local", command: []}` is what Rulesync used to write for a
        // server that named no transport, so it is on disk in real projects.
        // Throwing here took the whole `import` run down — every later feature
        // of it — over an entry with nothing to import. Read it as the
        // transport-less server it is; the write side then skips it.
        return [
          serverName,
          {
            ...extraFields,
            ...(serverConfig.enabled === false && { disabled: true }),
            ...(enabledTools.length > 0 && { enabledTools }),
            ...(disabledTools.length > 0 && { disabledTools }),
          },
        ];
      }
      return [
        serverName,
        {
          // Spread extras first so converter-derived fields below always win
          // on any key collision.
          ...extraFields,
          type: "stdio" as const,
          command,
          ...(args.length > 0 && { args }),
          ...(serverConfig.enabled === false && { disabled: true }),
          ...(serverConfig.environment && { env: serverConfig.environment }),
          ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
          ...(enabledTools.length > 0 && { enabledTools }),
          ...(disabledTools.length > 0 && { disabledTools }),
        },
      ];
    }),
  );
}

// OpenCode-supported per-server fields that rulesync does not map explicitly.
// On export these are copied verbatim so an OpenCode -> rulesync -> OpenCode
// round-trip preserves them. Unlike the import side — whose source is OpenCode's
// own format, where any unknown key is by definition an OpenCode field — the
// rulesync `mcp.json` is a multi-tool superset, so export uses an explicit
// allow-list to avoid leaking other tools' keys (e.g. `kiroAutoApprove`,
// `alwaysAllow`, `trust`) into `opencode.json`.
// https://opencode.ai/docs/mcp-servers
const OPENCODE_PASSTHROUGH_SERVER_FIELDS = ["timeout", "oauth"] as const;

/**
 * Convert standard MCP format to OpenCode native format
 * - type: "stdio" -> "local", "sse"/"http" -> "remote"
 * - command + args -> command (merged array)
 * - env -> environment
 * - disabled -> enabled (inverted)
 * - enabledTools/disabledTools -> top-level tools map (with server name prefix)
 * - OpenCode-supported extras (timeout, oauth) -> passed through verbatim
 */
function convertServerToOpencodeFormat(
  serverName: string,
  serverConfig: McpServerConfig,
  logger?: Logger,
): OpencodeMcpServer | null {
  // Preserve OpenCode-supported extras (e.g. timeout, oauth) on export so a
  // round-trip keeps them. Spread first so derived fields below always win.
  const serverRecord = serverConfig as Record<string, unknown>;
  const passthrough: Record<string, unknown> = {};
  for (const key of OPENCODE_PASSTHROUGH_SERVER_FIELDS) {
    if (serverRecord[key] !== undefined) {
      passthrough[key] = serverRecord[key];
    }
  }

  const enabled = serverConfig.disabled !== undefined ? !serverConfig.disabled : true;

  if (isRemoteMcpServer(serverConfig)) {
    const url = resolveRemoteMcpUrl(serverConfig);
    if (url === undefined) {
      return warnAndSkipMcpServer({
        toolName: "OpenCode",
        serverName,
        reason: "a remote transport but no url",
        logger,
      });
    }
    return {
      ...passthrough,
      type: "remote",
      url,
      enabled,
      ...(serverConfig.headers && { headers: serverConfig.headers }),
    };
  }

  const commandArray = resolveLocalMcpCommand(serverConfig);
  if (commandArray.length === 0) {
    // `{type: "local", command: []}` is a server OpenCode cannot start, and
    // this adapter throws on reading it back — so the file this generate
    // wrote would break the next import.
    return warnAndSkipMcpServer({
      toolName: "OpenCode",
      serverName,
      reason: declaresNoTransport(serverConfig)
        ? "no transport at all"
        : "a local transport but no command",
      logger,
    });
  }

  return {
    ...passthrough,
    type: "local",
    command: commandArray,
    enabled,
    ...(serverConfig.env && { environment: serverConfig.env }),
    ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
  };
}

function convertToOpencodeFormat(
  mcpServers: McpServers,
  logger?: Logger,
): {
  mcp: Record<string, OpencodeMcpServer>;
  tools: Record<string, boolean>;
} {
  const tools: Record<string, boolean> = {};

  const mcp = Object.fromEntries(
    Object.entries(mcpServers)
      .map(([serverName, serverConfig]) => {
        const converted = convertServerToOpencodeFormat(serverName, serverConfig, logger);

        // Collected whether or not an entry is written: the `tools` map is
        // keyed by server name and reaches servers `mcp` does not list, so a
        // filter turning off a dangerous tool is not this entry's to take away.
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
        return converted === null ? null : ([serverName, converted] as const);
      })
      .filter((entry) => entry !== null),
  );

  return { mcp, tools };
}

export class OpencodeMcp extends ToolMcp {
  private readonly json: OpencodeConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = OpencodeConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): OpencodeConfig {
    return this.json;
  }

  /**
   * opencode.json may contain other settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: OPENCODE_GLOBAL_DIR,
        relativeFilePath: OPENCODE_JSON_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: OPENCODE_JSON_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<OpencodeMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    // Always try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

    const fileContentToUse = fileContent ?? '{"mcp":{}}';
    const json = parseJsonc(fileContentToUse);
    const newJson = { ...json, mcp: json.mcp ?? {} };

    return new OpencodeMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
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
  }: ToolMcpFromRulesyncMcpParams): Promise<OpencodeMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

    const mcpServers = rulesyncMcp.getMcpServers();
    const transformedServers = convertEnvVarRefsToToolFormat({
      mcpServers,
      replacement: "{env:$1}",
    });
    const { mcp: convertedMcp, tools: mcpTools } = convertToOpencodeFormat(
      transformedServers,
      logger,
    );

    return new OpencodeMcp({
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
   * Register additional instruction file paths into the shared opencode config
   * (`opencode.json` / `opencode.jsonc`) under the `instructions` key.
   *
   * OpenCode auto-loads only the root `AGENTS.md` plus any files explicitly
   * listed in the `instructions` array of `opencode.json`; it does NOT
   * auto-discover a rules directory. rulesync writes non-root OpenCode rules to
   * `.opencode/memories/`, so those files must be registered here or they are
   * silently ignored. The root `AGENTS.md` is auto-loaded and must NOT be
   * registered. This merge is non-destructive: existing keys (notably
   * `mcp`/`tools`/`permission`/`$schema`) are preserved, and the resulting
   * `instructions` list is deduped and sorted for stable output.
   *
   * @see https://opencode.ai/docs/rules/
   * @see https://opencode.ai/docs/config/
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
  }): Promise<OpencodeMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    // Prefer opencode.jsonc, fall back to opencode.json, mirroring fromRulesyncMcp.
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

    const json = fileContent ? parseJsonc(fileContent) : {};
    const existingInstructions: string[] = Array.isArray(json.instructions)
      ? json.instructions.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];

    const mergedInstructions = Array.from(
      new Set([...existingInstructions, ...instructions]),
    ).toSorted();

    return new OpencodeMcp({
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
    const convertedMcpServers = convertFromOpencodeFormat(this.json.mcp ?? {}, this.json.tools);
    const transformedServers = convertEnvVarRefsFromToolFormat({
      mcpServers: convertedMcpServers,
      pattern: OPENCODE_ENV_VAR_PATTERN,
    });
    // A transport-less server is an OpenCode idea — a filter for a server
    // another config layer defines — so it goes in the block only OpenCode
    // reads rather than into the shared map every other tool writes out.
    const { shared, toolOnly } = splitMcpServersByTransport(transformedServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          mcpServers: shared,
          ...(Object.keys(toolOnly).length > 0 && { opencode: { mcpServers: toolOnly } }),
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    // Parse fileContent directly since this.json may not be initialized yet
    // when validate() is called from parent constructor
    const json = JSON.parse(this.fileContent || "{}");
    const result = OpencodeConfigSchema.safeParse(json);
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
  }: ToolMcpForDeletionParams): OpencodeMcp {
    return new OpencodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
