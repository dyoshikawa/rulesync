import { readFile } from "node:fs/promises";
import { RULESYNC_MCP_FILE } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";

export type RulesyncMcpParams = RulesyncFileParams;

// Re-export schema for validation consistency
export { RulesyncMcpConfigSchema as RulesyncMcpJsonSchema };

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

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static async fromFilePath({ filePath }: { filePath: string }): Promise<RulesyncMcp> {
    const fileContent = await readFile(filePath, "utf-8");

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: ".",
      relativeFilePath: RULESYNC_MCP_FILE,
      fileContent,
      validate: true,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  getFrontmatter(): Record<string, unknown> {
    return {};
  }
}
