import { join } from "node:path";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import {
  RulesyncFile,
  RulesyncFileFromFileParams,
  RulesyncFileParams,
} from "../types/rulesync-file.js";
import { readFileContent } from "../utils/file.js";

export type RulesyncMcpParams = RulesyncFileParams;

// Re-export schema for validation consistency
export { RulesyncMcpConfigSchema as RulesyncMcpJsonSchema };

export type RulesyncMcpFromFileParams = Pick<RulesyncFileFromFileParams, "validate">;

export type RulesyncMcpSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class RulesyncMcp extends RulesyncFile {
  private readonly json: Record<string, unknown>;

  constructor({ ...rest }: RulesyncMcpParams) {
    super({ ...rest });

    this.json = JSON.parse(this.fileContent);

    if (rest.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  static getSettablePaths(): RulesyncMcpSettablePaths {
    return {
      relativeDirPath: ".rulesync",
      relativeFilePath: ".mcp.json",
    };
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFile({ validate = true }: RulesyncMcpFromFileParams): Promise<RulesyncMcp> {
    const fileContent = await readFileContent(
      join(this.getSettablePaths().relativeDirPath, this.getSettablePaths().relativeFilePath),
    );

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }
}
