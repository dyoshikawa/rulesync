import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { McpServerSchema, McpServers } from "../../types/mcp.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export type CopilotCliMcpParams = ToolMcpParams;

type CopilotCliMcpConfig = {
  mcpServers?: {
    [key: string]: {
      type: "stdio";
      command: string;
      args?: string[];
      env?: Record<string, string>;
    };
  };
};

/**
 * Adds "type": "stdio" to each MCP server config if not present.
 * GitHub Copilot CLI requires the "type" field for each server.
 * @throws Error if a server doesn't have a command (Copilot CLI stdio servers require a command)
 */
function addTypeField(mcpServers: McpServers): CopilotCliMcpConfig["mcpServers"] {
  const result: CopilotCliMcpConfig["mcpServers"] = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    // Parse and validate the server config
    const parsed = McpServerSchema.parse(server);

    // Copilot CLI stdio servers require a non-empty command
    if (!parsed.command) {
      throw new Error(
        `MCP server "${name}" is missing a command. GitHub Copilot CLI stdio servers require a non-empty command.`
      );
    }

    // Handle command as string or array
    let command: string;
    let args: string[] | undefined;

    if (typeof parsed.command === "string") {
      command = parsed.command;
      args = parsed.args;
    } else {
      // command is an array: first element is command, rest are args
      const [cmd, ...cmdArgs] = parsed.command;
      command = cmd;
      // Merge command array args with existing args
      args = cmdArgs.length > 0 ? [...cmdArgs, ...(parsed.args ?? [])] : parsed.args;
    }

    result[name] = {
      type: "stdio",
      command,
      ...(args && { args }),
      ...(parsed.env && { env: parsed.env }),
    };
  }

  return result;
}

/**
 * Removes the "type" field when converting back to rulesync format.
 */
function removeTypeField(config: CopilotCliMcpConfig): McpServers {
  const result: McpServers = {};

  for (const [name, server] of Object.entries(config.mcpServers ?? {})) {
    const { type: _, ...rest } = server;
    result[name] = rest;
  }

  return result;
}

export class CopilotCliMcp extends ToolMcp {
  private readonly json: CopilotCliMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): CopilotCliMcpConfig {
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

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: ".copilot",
        relativeFilePath: "mcp-config.json",
      };
    }
    return {
      relativeDirPath: ".copilot",
      relativeFilePath: "mcp-config.json",
    };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CopilotCliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(join(baseDir, paths.relativeDirPath, paths.relativeFilePath))) ??
      '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CopilotCliMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotCliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(baseDir, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    // Convert rulesync format to Copilot CLI format (add "type": "stdio")
    const copilotCliMcpServers = addTypeField(rulesyncMcp.getMcpServers());
    const mcpJson = { ...json, mcpServers: copilotCliMcpServers };

    return new CopilotCliMcp({
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
  }: ToolMcpForDeletionParams): CopilotCliMcp {
    return new CopilotCliMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
