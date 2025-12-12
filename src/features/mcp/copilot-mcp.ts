import { join } from "node:path";
import { ValidationResult } from "../../types/ai-file.js";
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

export class CopilotMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = this.fileContent !== undefined ? JSON.parse(this.fileContent) : {};
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
    const { mcpServers, ...rest } = rulesyncMcp.getJson();
    const copilotJson = {
      ...rest,
      servers: mcpServers,
    } satisfies Record<string, unknown>;

    return new CopilotMcp({
      baseDir,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent: JSON.stringify(copilotJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const { servers, mcpServers, ...rest } = this.getJson();
    const mergedMcpServers =
      (typeof servers === "object" && servers !== null
        ? servers
        : typeof mcpServers === "object" && mcpServers !== null
          ? mcpServers
          : {}) ?? {};
    const rulesyncJson = {
      ...rest,
      mcpServers: mergedMcpServers,
    } satisfies Record<string, unknown>;

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify(rulesyncJson, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
