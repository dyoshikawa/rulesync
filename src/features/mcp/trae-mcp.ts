import { join } from "node:path";

import { TRAE_DIR, TRAE_MCP_FILE_NAME } from "../../constants/trae-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
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

/**
 * MCP generator for Trae (ByteDance's AI IDE, "TraeCode" in its docs).
 *
 * Trae loads project-level MCP servers from `.trae/mcp.json`, a standard
 * `mcpServers` object: `command` / `args` / `env` for stdio servers and `url` /
 * `headers` for HTTP servers. The only variable it expands is
 * `${workspaceFolder}`, which is passed through untouched.
 *
 * @see https://docs.trae.ai/ide/add-mcp-servers?_lang=en
 */
export class TraeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent === undefined) {
      this.json = {};
      return;
    }
    try {
      this.json = JSON.parse(this.fileContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Trae MCP config at ${join(this.relativeDirPath, this.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Project scope only: Trae's user-level MCP servers are managed through the
    // IDE's settings UI, with no documented file path.
    return {
      relativeDirPath: TRAE_DIR,
      relativeFilePath: TRAE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<TraeMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent = await readFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
    );

    return new TraeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): TraeMcp {
    const paths = this.getSettablePaths({ global });

    // Preserve top-level fields ($schema, etc.) from the source JSON, but
    // use getMcpServers() (not getJson().mcpServers) so rulesync-only
    // fields and codex-only fields (`envVars`) are stripped before
    // writing the Trae config.
    const json = rulesyncMcp.getJson();
    const fileContent = JSON.stringify(
      { ...json, mcpServers: rulesyncMcp.getMcpServers() },
      null,
      2,
    );

    return new TraeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
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
    global = false,
  }: ToolMcpForDeletionParams): TraeMcp {
    return new TraeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
