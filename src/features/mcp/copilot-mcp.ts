import { join } from "node:path";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
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

export type CopilotMcpParams = ToolMcpParams;

type CopilotMcpConfig = {
  servers?: McpServers;
};

function convertToCopilotFormat(mcpServers: McpServers): CopilotMcpConfig {
  return { servers: mcpServers };
}

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
      relativeDirPath: ".vscode",
      relativeFilePath: "mcp.json",
    };
  }
  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<CopilotMcp> {
    const fileContent = await readFileContent(
      join(
        baseDir,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    baseDir = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): CopilotMcp {
    const copilotConfig = convertToCopilotFormat(rulesyncMcp.getMcpServers());
    return new CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(copilotConfig, null, 2),
      validate,
    });
  }

  toRulesyncMcp({ outputBaseDir }: { outputBaseDir?: string } = {}): RulesyncMcp {
    const mcpServers = convertFromCopilotFormat(this.json);
    return this.toRulesyncMcpDefault({
      outputBaseDir,
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
  }: ToolMcpForDeletionParams): CopilotMcp {
    return new CopilotMcp({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
