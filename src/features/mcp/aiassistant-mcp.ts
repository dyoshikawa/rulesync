import { join } from "node:path";

import {
  AIASSISTANT_MCP_DIR_PATH,
  AIASSISTANT_MCP_FILE_NAME,
} from "../../constants/aiassistant-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export class AiassistantMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // JetBrains AI Assistant reads project-level MCP config from
    // `.ai/mcp/mcp.json` and global (user-level) config from
    // `~/.ai/mcp/mcp.json`. The relative path is identical for both scopes;
    // the base directory changes (cwd for project, home dir for global).
    return {
      relativeDirPath: AIASSISTANT_MCP_DIR_PATH,
      relativeFilePath: AIASSISTANT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<AiassistantMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new AiassistantMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): AiassistantMcp {
    const paths = this.getSettablePaths({ global });

    // Preserve top-level fields ($schema, etc.) from the source JSON, but
    // use getMcpServers() so rulesync-only fields and codex-only fields
    // (`envVars`) are stripped before writing the aiassistant config.
    const json = rulesyncMcp.getJson();
    const fileContent = JSON.stringify(
      { ...json, mcpServers: rulesyncMcp.getMcpServers() },
      null,
      2,
    );

    return new AiassistantMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): AiassistantMcp {
    return new AiassistantMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
