import { readFile } from "node:fs/promises";
import { RULESYNC_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";

export interface RulesyncMcpParams extends RulesyncFileParams {
  json: Record<string, unknown>;
}

// Re-export schema for validation consistency
export { RulesyncMcpConfigSchema as RulesyncMcpJsonSchema };

export class RulesyncMcp extends RulesyncFile {
  private readonly json: Record<string, unknown>;

  constructor({ json, ...rest }: RulesyncMcpParams) {
    super({ ...rest });
    this.json = json;
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncMcp> {
    const fileContent = await readFile(filePath, "utf-8");

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_MCP_FILE,
      body: fileContent,
      fileContent,
      json: JSON.parse(fileContent),
      validate: false,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  getFrontmatter(): Record<string, unknown> {
    return {};
  }
}
