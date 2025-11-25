import { join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

// OpenCode MCP server schemas
// OpenCode uses "local"/"remote" instead of "stdio"/"sse"/"http",
// "environment" instead of "env", and "enabled" instead of "disabled"

// OpenCode native format for local servers
const OpencodeMcpLocalServerSchema = z.object({
  type: z.literal("local"),
  command: z.array(z.string()),
  environment: z.optional(z.record(z.string(), z.string())),
  enabled: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
});

// OpenCode native format for remote servers
const OpencodeMcpRemoteServerSchema = z.object({
  type: z.literal("remote"),
  url: z.string(),
  headers: z.optional(z.record(z.string(), z.string())),
  enabled: z.optional(z.boolean()),
});

// OpenCode MCP server schema (local or remote)
const OpencodeMcpServerSchema = z.union([
  OpencodeMcpLocalServerSchema,
  OpencodeMcpRemoteServerSchema,
]);

// Use looseObject to allow additional properties like model, provider, agent, etc.
const OpencodeConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  mcp: z.optional(z.record(z.string(), OpencodeMcpServerSchema)),
});

type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;
type OpencodeMcpServer = z.infer<typeof OpencodeMcpServerSchema>;

/**
 * Convert standard MCP format to OpenCode native format
 * - type: "stdio" -> "local", "sse"/"http" -> "remote"
 * - command + args -> command (merged array)
 * - env -> environment
 * - disabled -> enabled (inverted)
 */
function convertToOpencodeFormat(mcpServers: McpServers): Record<string, OpencodeMcpServer> {
  return Object.fromEntries(
    Object.entries(mcpServers).map(([serverName, serverConfig]) => {
      const isRemote =
        serverConfig.type === "sse" || serverConfig.type === "http" || serverConfig.url;

      if (isRemote) {
        const remoteServer: OpencodeMcpServer = {
          type: "remote",
          url: serverConfig.url ?? serverConfig.httpUrl ?? "",
          ...(serverConfig.headers && { headers: serverConfig.headers }),
          ...(serverConfig.disabled !== undefined && { enabled: !serverConfig.disabled }),
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
        type: "local",
        command: commandArray,
        ...(serverConfig.env && { environment: serverConfig.env }),
        ...(serverConfig.disabled !== undefined && { enabled: !serverConfig.disabled }),
        ...(serverConfig.cwd && { cwd: serverConfig.cwd }),
      };
      return [serverName, localServer];
    }),
  );
}

export class OpencodeMcp extends ToolMcp {
  private readonly json: OpencodeConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = OpencodeConfigSchema.parse(JSON.parse(this.fileContent || "{}"));
  }

  getJson(): OpencodeConfig {
    return this.json;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: ".",
        relativeFilePath: "opencode.json",
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: "opencode.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<OpencodeMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcp: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcp: json.mcp ?? {} };

    return new OpencodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<OpencodeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcp: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const convertedMcp = convertToOpencodeFormat(rulesyncMcp.getExposedMcpServers());
    const newJson = { ...json, mcp: convertedMcp };

    return new OpencodeMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcp }, null, 2),
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
}
