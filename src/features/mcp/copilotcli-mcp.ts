import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, type McpServer, type McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  type ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export type CopilotcliMcpParams = ToolMcpParams;

type CopilotcliMcpConfig = {
  mcpServers?: Record<string, McpServer & Record<string, unknown>>;
};

/**
 * Adds "type": "stdio" to each MCP server config if not present.
 * GitHub Copilot CLI requires the "type" field for each server.
 * @throws Error if a stdio server doesn't have a command
 */
function addTypeField(mcpServers: McpServers): CopilotcliMcpConfig["mcpServers"] {
  const result: NonNullable<CopilotcliMcpConfig["mcpServers"]> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    const parsed = McpServerSchema.parse(server);
    const type = parsed.type ?? "stdio";

    if (type !== "stdio") {
      result[name] = {
        ...parsed,
        type,
      };
      continue;
    }

    if (!parsed.command) {
      throw new Error(
        `MCP server "${name}" is missing a command. GitHub Copilot CLI stdio servers require a non-empty command.`,
      );
    }

    let command: string;
    let args: string[] | undefined;

    if (typeof parsed.command === "string") {
      command = parsed.command;
      args = parsed.args;
    } else {
      const [cmd, ...cmdArgs] = parsed.command;
      if (!cmd) {
        throw new Error(`MCP server "${name}" has an empty command array.`);
      }
      command = cmd;
      args = cmdArgs.length > 0 ? [...cmdArgs, ...(parsed.args ?? [])] : parsed.args;
    }

    result[name] = {
      ...parsed,
      type,
      command,
      ...(args && { args }),
    };
  }

  return result;
}

/**
 * Removes the "type" field when converting back to rulesync format.
 */
function removeTypeField(config: CopilotcliMcpConfig): McpServers {
  const result: McpServers = {};

  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    if (server.type !== "stdio") {
      result[name] = server;
      continue;
    }

    const { type: _, ...rest } = server;
    result[name] = rest;
  }

  return result;
}

export class CopilotcliMcp extends ToolMcp {
  private readonly json: CopilotcliMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): CopilotcliMcpConfig {
    return this.json;
  }

  /**
   * In global mode, ~/.copilot/mcp-config.json should not be deleted
   * as it may contain other user settings.
   * In local mode, .copilot/mcp-config.json can be safely deleted.
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    return {
      relativeDirPath: ".copilot",
      relativeFilePath: "mcp-config.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(join(baseDir, paths.relativeDirPath, paths.relativeFilePath))) ??
      '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CopilotcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    // Convert rulesync format to Copilot CLI format (add "type": "stdio")
    const copilotCliMcpServers = addTypeField(rulesyncMcp.getMcpServers());
    const mcpJson = { ...json, mcpServers: copilotCliMcpServers };

    return new CopilotcliMcp({
      baseDir,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mcpJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    // Convert Copilot CLI format back to rulesync format (remove "type" field)
    const mcpServers = removeTypeField(this.json);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): CopilotcliMcp {
    return new CopilotcliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
