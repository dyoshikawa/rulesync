import { join } from "node:path";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
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
 * MCP generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Antigravity uses a dedicated `mcp_config.json` whose `mcpServers` map is
 * written at the top level (`disabledTools` per server is supported). Unlike
 * Gemini CLI's shared `settings.json`, this file is dedicated to MCP, so it is
 * safely deletable.
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/antigravity/mcp_config.json`
 */
export class AntigravityIdeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".gemini", "antigravity"),
        relativeFilePath: "mcp_config.json",
      };
    }
    return {
      relativeDirPath: ".agents",
      relativeFilePath: "mcp_config.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<AntigravityIdeMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new AntigravityIdeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<AntigravityIdeMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new AntigravityIdeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.mcpServers ?? {} }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): AntigravityIdeMcp {
    return new AntigravityIdeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
