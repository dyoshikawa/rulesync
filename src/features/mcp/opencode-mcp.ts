import { join } from "node:path";
import { z } from "zod/mini";
import { ValidationResult } from "../../types/ai-file.js";
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
// OpenCode native format uses "local"/"remote" instead of "stdio"/"sse"/"http",
// "environment" instead of "env", and "enabled" instead of "disabled"
// However, fromRulesyncMcp passes standard MCP format (command, args, env, etc.)
// so we need to accept both formats

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

// Standard MCP format (from RulesyncMcp)
const StandardMcpServerSchema = z.object({
  type: z.optional(z.enum(["stdio", "sse", "http"])),
  command: z.optional(z.union([z.string(), z.array(z.string())])),
  args: z.optional(z.array(z.string())),
  url: z.optional(z.string()),
  httpUrl: z.optional(z.string()),
  env: z.optional(z.record(z.string(), z.string())),
  disabled: z.optional(z.boolean()),
  cwd: z.optional(z.string()),
  headers: z.optional(z.record(z.string(), z.string())),
});

// Accept both OpenCode native format and standard MCP format
const OpencodeMcpServerSchema = z.union([
  OpencodeMcpLocalServerSchema,
  OpencodeMcpRemoteServerSchema,
  StandardMcpServerSchema,
]);

// Use looseObject to allow additional properties like model, provider, agent, etc.
const OpencodeConfigSchema = z.looseObject({
  $schema: z.optional(z.string()),
  mcp: z.optional(z.record(z.string(), OpencodeMcpServerSchema)),
});

type OpencodeConfig = z.infer<typeof OpencodeConfigSchema>;

export class OpencodeMcp extends ToolMcp {
  private readonly json: OpencodeConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    // eslint-disable-next-line no-type-assertion/no-type-assertion -- JSON.parse returns unknown, type is validated in validate()
    this.json = JSON.parse(this.fileContent || "{}") as OpencodeConfig;
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
    const newJson = { ...json, mcp: rulesyncMcp.getExposedMcpServers() };

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
