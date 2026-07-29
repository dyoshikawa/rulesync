import { join } from "node:path";

import { COPILOT_MCP_DIR, COPILOT_MCP_FILE_NAME } from "../../constants/copilot-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/**
 * `.vscode/mcp.json` has three documented top-level sections: `servers` (the
 * one rulesync manages), `inputs` (secret prompts referenced as
 * `${input:id}`) and `sandbox` (filesystem/network rules for sandboxed
 * servers). Only `servers` is generated; the rest of the document is read back
 * and preserved, since VS Code recommends committing this file and dropping an
 * `inputs` entry would leave `${input:…}` unresolvable at startup.
 *
 * @see https://code.visualstudio.com/docs/agents/reference/mcp-configuration
 */
type CopilotMcpConfig = {
  servers?: McpServers;
  [key: string]: unknown;
};

function convertFromCopilotFormat(copilotConfig: CopilotMcpConfig): McpServers {
  return copilotConfig.servers ?? {};
}

export class CopilotMcp extends ToolMcp {
  private readonly json: CopilotMcpConfig;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): CopilotMcpConfig {
    return this.json;
  }

  static getSettablePaths(): ToolMcpSettablePaths {
    return {
      relativeDirPath: COPILOT_MCP_DIR,
      relativeFilePath: COPILOT_MCP_FILE_NAME,
    };
  }
  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<CopilotMcp> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CopilotMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): Promise<CopilotMcp> {
    const paths = this.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readFileContentOrNull(filePath);

    let existing: CopilotMcpConfig = {};
    if (existingContent !== null && existingContent.trim() !== "") {
      try {
        existing = JSON.parse(existingContent);
      } catch (error) {
        // Fail loudly rather than write a file that would silently drop the
        // user's `inputs` / `sandbox` sections.
        throw new Error(
          `Failed to parse existing Copilot MCP config at ${filePath}: ${formatError(error)}`,
          { cause: error },
        );
      }
    }

    const copilotConfig: CopilotMcpConfig = { ...existing, servers: rulesyncMcp.getMcpServers() };
    return new CopilotMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(copilotConfig, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCopilotFormat(this.json);
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
  }: ToolMcpForDeletionParams): CopilotMcp {
    return new CopilotMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
