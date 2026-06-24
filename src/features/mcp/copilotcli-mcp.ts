import { join } from "node:path";

import {
  COPILOT_DIR,
  COPILOTCLI_MCP_FILE_NAME,
  COPILOTCLI_PROJECT_MCP_FILE_NAME,
  GITHUB_DIR,
} from "../../constants/copilot-paths.js";
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

type CopilotcliMcpConfig = {
  mcpServers?: Record<string, McpServer & Record<string, unknown>>;
};

type CopilotcliServerType = NonNullable<McpServer["type"]>;

const isRemoteServerType = (
  type: CopilotcliServerType,
): type is Extract<CopilotcliServerType, "http" | "sse"> => {
  return type === "http" || type === "sse";
};

const resolveCopilotcliServerType = (server: McpServer): CopilotcliServerType => {
  if (server.type) {
    return server.type;
  }

  if (server.transport === "http" || server.transport === "sse" || server.transport === "local") {
    return server.transport;
  }

  return "stdio";
};

/**
 * Resolves and sets the transport type for each MCP server config.
 * GitHub Copilot CLI requires the "type" field for each server.
 * @throws Error if a stdio/local server doesn't have a command
 * @throws Error if an http/sse server doesn't have a url or httpUrl
 */
function addTypeField(mcpServers: McpServers): CopilotcliMcpConfig["mcpServers"] {
  const result: NonNullable<CopilotcliMcpConfig["mcpServers"]> = {};

  for (const [name, server] of Object.entries(mcpServers)) {
    const parsed = McpServerSchema.parse(server);
    const type = resolveCopilotcliServerType(parsed);

    if (isRemoteServerType(type)) {
      if (!parsed.url && !parsed.httpUrl) {
        throw new Error(
          `MCP server "${name}" is missing a url or httpUrl. GitHub Copilot CLI ${type} servers require a non-empty url or httpUrl.`,
        );
      }

      result[name] = {
        ...parsed,
        type,
      };
      continue;
    }

    if (!parsed.command) {
      throw new Error(
        `MCP server "${name}" is missing a command. GitHub Copilot CLI ${type} servers require a non-empty command.`,
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
   * In project mode, .github/mcp.json is a rulesync-managed workspace MCP file
   * and can be safely deleted.
   */
  override isDeletable(): boolean {
    return !this.global;
  }

  /**
   * - **Project scope**: `<project>/.github/mcp.json` — the Copilot CLI
   *   auto-loads MCP servers from this workspace config file. It uses the
   *   standard `{ "mcpServers": {...} }` shape.
   *   https://github.com/github/copilot-cli (changelog v1.0.61, 2026-06-09)
   * - **Global scope**: `~/.copilot/mcp-config.json` — the personal/global
   *   Copilot CLI MCP configuration.
   */
  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: COPILOT_DIR,
        relativeFilePath: COPILOTCLI_MCP_FILE_NAME,
      };
    }
    return {
      relativeDirPath: GITHUB_DIR,
      relativeFilePath: COPILOTCLI_PROJECT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new CopilotcliMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotcliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);

    // Convert rulesync format to Copilot CLI format (add "type": "stdio")
    const copilotCliMcpServers = addTypeField(rulesyncMcp.getMcpServers());
    const mcpJson = { ...json, mcpServers: copilotCliMcpServers };

    return new CopilotcliMcp({
      outputRoot,
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
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): CopilotcliMcp {
    return new CopilotcliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
