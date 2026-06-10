import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
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

// Kilo MCP server schema (local or remote)
const KiloMcpServerSchema = z.union([KiloMcpLocalServerSchema, KiloMcpRemoteServerSchema]);

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
    Object.entries(kiloMcp).map(([serverName, serverConfig]) => {
      // Extract enabledTools and disabledTools from top-level tools map
      const enabledTools: string[] = [];
      const disabledTools: string[] = [];
      const prefix = `${serverName}_`;

      if (tools) {
        for (const [toolName, enabled] of Object.entries(tools)) {
          if (toolName.startsWith(prefix)) {
            const toolSuffix = toolName.slice(prefix.length);
            if (enabled) {
              enabledTools.push(toolSuffix);
            } else {
              disabledTools.push(toolSuffix);
            }
          }
        }
      }

      if (serverConfig.type === "remote") {
        return [
          serverName,
          {
            // Kilo's `remote` transport is transport-agnostic; SSE is deprecated
            // by the MCP spec (2025-03-26) in favor of Streamable HTTP, so import
            // as `http` rather than the legacy `sse`.
            type: "http" as const,
            url: serverConfig.url,
            ...(serverConfig.enabled === false && { disabled: true }),
            ...(serverConfig.headers && { headers: serverConfig.headers }),
            ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
            ...(serverConfig.oauth !== undefined && { oauth: serverConfig.oauth }),
            ...(enabledTools.length > 0 && { enabledTools }),
            ...(disabledTools.length > 0 && { disabledTools }),
          },
        ];
      }

      // local server -> stdio
      const [command, ...args] = serverConfig.command;
      if (!command) {
        throw new Error(`Server "${serverName}" has an empty command array`);
      }
      return [
        serverName,
        {
          type: "stdio" as const,
          command,
          ...(args.length > 0 && { args }),
          ...(serverConfig.enabled === false && { disabled: true }),
          ...(serverConfig.environment && { env: serverConfig.environment }),
          ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
          ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
          ...(enabledTools.length > 0 && { enabledTools }),
          ...(disabledTools.length > 0 && { disabledTools }),
        },
      ];
    }),
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
function convertToKiloFormat(mcpServers: McpServers): {
  mcp: Record<string, KiloMcpServer>;
  tools: Record<string, boolean>;
} {
  const tools: Record<string, boolean> = {};

  const mcp = Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const isRemote =
        serverConfig.type === "sse" || serverConfig.type === "http" || serverConfig.url;

      // Collect enabledTools/disabledTools into the top-level tools map
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

      if (isRemote) {
        // `oauth` is Kilo-specific (object | false) and carried through via the
        // rulesync MCP server's looseObject passthrough; it is not a declared
        // field on McpServerSchema.
        const oauth = (serverConfig as { oauth?: unknown }).oauth;
        const remoteServer: KiloMcpServer = {
          type: "remote",
          url: serverConfig.url ?? serverConfig.httpUrl ?? "",
          enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
          ...(serverConfig.headers && { headers: serverConfig.headers }),
          ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
          ...(oauth !== undefined && { oauth: oauth as z.infer<typeof KiloMcpOAuthSchema> }),
        };
        return [serverName, remoteServer];
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

      const localServer: KiloMcpServer = {
        type: "local",
        command: commandArray,
        enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
        ...(serverConfig.env && { environment: serverConfig.env }),
        ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
        ...(serverConfig.timeout !== undefined && { timeout: serverConfig.timeout }),
      };
      return [serverName, localServer];
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
        relativeDirPath: join(".config", "kilo"),
        relativeFilePath: "kilo.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: "kilo.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<KiloMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = "kilo.jsonc";

    const jsoncPath = join(jsonDir, "kilo.jsonc");
    const jsonPath = join(jsonDir, "kilo.json");

    // Always try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "kilo.json";
      }
    }

    const fileContentToUse = fileContent ?? '{"mcp":{}}';
    const json = parseJsonc(fileContentToUse);
    const newJson = { ...json, mcp: json.mcp ?? {} };

    return new KiloMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<KiloMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = "kilo.jsonc";

    const jsoncPath = join(jsonDir, "kilo.jsonc");
    const jsonPath = join(jsonDir, "kilo.json");

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "kilo.json";
      }
    }

    // If neither exists, default to jsonc and empty mcp object
    if (!fileContent) {
      fileContent = JSON.stringify({ mcp: {} }, null, 2);
    }

    const json = parseJsonc(fileContent);
    const { mcp: convertedMcp, tools: mcpTools } = convertToKiloFormat(rulesyncMcp.getMcpServers());

    const { tools: _existingTools, ...jsonWithoutTools } = json;
    const newJson = {
      ...jsonWithoutTools,
      mcp: convertedMcp,
      ...(Object.keys(mcpTools).length > 0 && { tools: mcpTools }),
    };

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
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
    let relativeFilePath = "kilo.jsonc";

    const jsoncPath = join(jsonDir, "kilo.jsonc");
    const jsonPath = join(jsonDir, "kilo.json");

    // Prefer kilo.jsonc, fall back to kilo.json, mirroring fromRulesyncMcp.
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "kilo.json";
      }
    }

    const json = fileContent ? parseJsonc(fileContent) : {};
    const existingInstructions: string[] = Array.isArray(json.instructions)
      ? json.instructions.filter((entry: unknown): entry is string => typeof entry === "string")
      : [];

    const mergedInstructions = Array.from(
      new Set([...existingInstructions, ...instructions]),
    ).toSorted();

    // Spread the existing config first so mcp/tools/$schema and any other keys
    // are preserved; only the instructions key is added/replaced.
    const newJson = {
      ...json,
      instructions: mergedInstructions,
    };

    return new KiloMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
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
