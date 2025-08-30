import { AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export interface ToolMcpParams extends AiFileParams {
  json: Record<string, unknown>;
}

export type ToolMcpFromRulesyncMcpParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath"
> & {
  rulesyncMcp: RulesyncMcp;
};

export abstract class ToolMcp extends ToolFile {
  protected readonly json: Record<string, unknown>;

  constructor({ json, ...rest }: ToolMcpParams) {
    super({
      ...rest,
      validate: false, // Skip validation during construction
    });
    this.json = json;

    // Validate after setting patterns, if validation was requested
    if (rest.validate !== false) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  abstract toRulesyncMcp(): RulesyncMcp;

  static async fromFilePath(_params: { filePath: string }): Promise<ToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncMcp(_params: ToolMcpFromRulesyncMcpParams): ToolMcp {
    throw new Error("Please implement this method in the subclass.");
  }
}
