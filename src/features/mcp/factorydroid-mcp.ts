import { join } from "node:path";

import {
  FACTORYDROID_DIR,
  FACTORYDROID_MCP_FILE_NAME,
} from "../../constants/factorydroid-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
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

export class FactorydroidMcp extends ToolMcp {
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
      relativeDirPath: FACTORYDROID_DIR,
      relativeFilePath: FACTORYDROID_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolMcpFromFileParams): Promise<FactorydroidMcp> {
    const fileContent = await readFileContent(
      join(
        outputRoot,
        this.getSettablePaths().relativeDirPath,
        this.getSettablePaths().relativeFilePath,
      ),
    );

    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
  }: ToolMcpFromRulesyncMcpParams): FactorydroidMcp {
    // Use getMcpServers() (not getJson()) so rulesync-only fields and
    // codex-only fields (`envVars`) are stripped before writing the
    // Factory Droid config.
    const mcpServers = rulesyncMcp.getMcpServers();

    // Factory Droid uses standard MCP format without transformations
    const factorydroidConfig = {
      mcpServers,
    };

    const fileContent = JSON.stringify(factorydroidConfig, null, 2);

    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath: this.getSettablePaths().relativeDirPath,
      relativeFilePath: this.getSettablePaths().relativeFilePath,
      fileContent,
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault();
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolMcpForDeletionParams): FactorydroidMcp {
    return new FactorydroidMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
