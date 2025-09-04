import { join } from "node:path";
import { RULESYNC_DIR } from "../constants/paths.js";
import { ValidationResult } from "../types/ai-file.js";
import { RulesyncMcpConfigSchema } from "../types/mcp.js";
import { RulesyncFile, RulesyncFileParams } from "../types/rulesync-file.js";
import { readFileContent } from "../utils/file.js";

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

  static async fromFile(): Promise<RulesyncMcp> {
    const fileContent = await readFileContent(join(RULESYNC_DIR, ".mcp.json"));

    return new RulesyncMcp({
      baseDir: ".",
      relativeDirPath: RULESYNC_DIR,
      relativeFilePath: ".mcp.json",
      fileContent,
      validate: true,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }
}
