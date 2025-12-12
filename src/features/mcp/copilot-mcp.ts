import { join } from "node:path";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { readFileContent } from "../../utils/file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

export type CopilotMcpParams = ToolMcpParams;

type CopilotMcpJson = Record<string, unknown> & { servers: McpServers };

const isRecord = (value: unknown): value is Record<string, unknown> =>
  typeof value === "object" && value !== null && !Array.isArray(value);

export class CopilotMcp extends ToolMcp {
  private readonly json: CopilotMcpJson;

  constructor(params: ToolMcpParams) {
    super(params);
    const parsedJson = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
    this.json = this.normalizeJson(parsedJson);
  }

  getJson(): Record<string, unknown> {
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
    const parsedRulesyncJson = JSON.parse(rulesyncMcp.getFileContent());
    const rulesyncJson = isRecord(parsedRulesyncJson) ? parsedRulesyncJson : {};

    const servers = rulesyncMcp.getMcpServers();
    const { mcpServers: _legacyServers, ...rest } = rulesyncJson;

    return new CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify({ ...rest, servers }, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const { servers, ...rest } = this.json;

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(
        {
          ...rest,
          mcpServers: servers ?? {},
        },
        null,
        2,
      ),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  private normalizeJson(json: Record<string, unknown>): CopilotMcpJson {
    const { servers, mcpServers, ...rest } = json;
    const normalizedServers = this.extractServers({ servers, mcpServers });

    return {
      ...rest,
      servers: normalizedServers,
    };
  }

  private extractServers({
    servers,
    mcpServers,
  }: {
    servers?: unknown;
    mcpServers?: unknown;
  }): McpServers {
    if (this.isServerRecord(servers)) {
      return servers;
    }
    if (this.isServerRecord(mcpServers)) {
      return mcpServers;
    }
    return {};
  }

  private isServerRecord(value: unknown): value is McpServers {
    return isRecord(value);
  }
}
