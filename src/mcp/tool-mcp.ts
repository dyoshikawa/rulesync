import { AiFileFromFileParams, AiFileParams } from "../types/ai-file.js";
import { ToolFile } from "../types/tool-file.js";
import { RulesyncMcp } from "./rulesync-mcp.js";

export type ToolMcpParams = AiFileParams;

export type ToolMcpFromRulesyncMcpParams = Omit<
  AiFileParams,
  "fileContent" | "relativeFilePath" | "relativeDirPath"
> & {
  rulesyncMcp: RulesyncMcp;
};

export type ToolMcpFromFileParams = Pick<AiFileFromFileParams, "baseDir" | "validate">;

export abstract class ToolMcp extends ToolFile {
  protected readonly json: Record<string, unknown>;

  constructor({ ...rest }: ToolMcpParams) {
    super({
      ...rest,
      validate: true, // Skip validation during construction
    });

    this.json = JSON.parse(this.fileContent);

    // Validate after setting patterns, if validation was requested
    if (rest.validate) {
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

  protected toRulesyncMcpDefault(): RulesyncMcp {
    return new RulesyncMcp({
      baseDir: this.baseDir,
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
      fileContent: this.fileContent,
    });
  }

  static async fromFile(_params: ToolMcpFromFileParams): Promise<ToolMcp> {
    throw new Error("Please implement this method in the subclass.");
  }

  static fromRulesyncMcp(_params: ToolMcpFromRulesyncMcpParams): ToolMcp {
    throw new Error("Please implement this method in the subclass.");
  }
}
