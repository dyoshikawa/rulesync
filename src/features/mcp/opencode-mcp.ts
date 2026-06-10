import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  convertEnvVarRefsFromToolFormat,
  convertEnvVarRefsToToolFormat,
} from "./mcp-env-var-format.js";
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

// OpenCode MCP server schema (local or remote)
const OpencodeMcpServerSchema = z.union([
  OpencodeMcpLocalServerSchema,
  OpencodeMcpRemoteServerSchema,
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
  return Object.fromEntries(
    Object.entries(opencodeMcp).map(([serverName, serverConfig]) => {
      // Preserve documented-but-unmodeled fields (e.g. `timeout`, `oauth`) on import.
      const extraFields = Object.fromEntries(
        Object.entries(serverConfig).filter(([key]) => !OPENCODE_KNOWN_SERVER_KEYS.has(key)),
      );

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
        throw new Error(`Server "${serverName}" has an empty command array`);
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
function convertToOpencodeFormat(mcpServers: McpServers): {
  mcp: Record<string, OpencodeMcpServer>;
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

      // Preserve OpenCode-supported extras (e.g. timeout, oauth) on export so a
      // round-trip keeps them. Spread first so derived fields below always win.
      const serverRecord = serverConfig as Record<string, unknown>;
      const passthrough: Record<string, unknown> = {};
      for (const key of OPENCODE_PASSTHROUGH_SERVER_FIELDS) {
        if (serverRecord[key] !== undefined) {
          passthrough[key] = serverRecord[key];
        }
      }

      if (isRemote) {
        const remoteServer: OpencodeMcpServer = {
          ...passthrough,
          type: "remote",
          url: serverConfig.url ?? serverConfig.httpUrl ?? "",
          enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
          ...(serverConfig.headers && { headers: serverConfig.headers }),
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

      const localServer: OpencodeMcpServer = {
        ...passthrough,
        type: "local",
        command: commandArray,
        enabled: serverConfig.disabled !== undefined ? !serverConfig.disabled : true,
        ...(serverConfig.env && { environment: serverConfig.env }),
        ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
      };
      return [serverName, localServer];
    }),
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
        relativeDirPath: join(".config", "opencode"),
        relativeFilePath: "opencode.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: "opencode.json",
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
    let relativeFilePath = "opencode.jsonc";

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    // Always try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
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
  }: ToolMcpFromRulesyncMcpParams): Promise<OpencodeMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = "opencode.jsonc";

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    // Try JSONC first (preferred format), then fall back to JSON
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
      }
    }

    // If neither exists, default to jsonc and empty mcp object
    if (!fileContent) {
      fileContent = JSON.stringify({ mcp: {} }, null, 2);
    }

    const json = parseJsonc(fileContent);
    const mcpServers = rulesyncMcp.getMcpServers();
    const transformedServers = convertEnvVarRefsToToolFormat({
      mcpServers,
      replacement: "{env:$1}",
    });
    const { mcp: convertedMcp, tools: mcpTools } = convertToOpencodeFormat(transformedServers);

    const { tools: _existingTools, ...jsonWithoutTools } = json;
    const newJson = {
      ...jsonWithoutTools,
      mcp: convertedMcp,
      ...(Object.keys(mcpTools).length > 0 && { tools: mcpTools }),
    };

    return new OpencodeMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
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
    let relativeFilePath = "opencode.jsonc";

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    // Prefer opencode.jsonc, fall back to opencode.json, mirroring fromRulesyncMcp.
    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
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

    return new OpencodeMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const convertedMcpServers = convertFromOpencodeFormat(this.json.mcp ?? {}, this.json.tools);
    const transformedServers = convertEnvVarRefsFromToolFormat({
      mcpServers: convertedMcpServers,
      pattern: OPENCODE_ENV_VAR_PATTERN,
    });
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: transformedServers }, null, 2),
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
