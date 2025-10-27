import { join } from "node:path";
import { AiFile, AiFileParams, ValidationResult } from "../types/ai-file.js";

export type ModularMcpParams = AiFileParams;

export type ModularMcpSettablePaths = {
  relativeDirPath: string;
  relativeFilePath: string;
};

export class ModularMcp extends AiFile {
  private readonly json: Record<string, unknown>;

  constructor(params: ModularMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(): ModularMcpSettablePaths {
    return {
      relativeDirPath: ".",
      relativeFilePath: "modular-mcp.json",
    };
  }

  getAbsolutePath(): string {
    const paths = ModularMcp.getSettablePaths();
    return join(this.baseDir, paths.relativeDirPath, paths.relativeFilePath);
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }
}
