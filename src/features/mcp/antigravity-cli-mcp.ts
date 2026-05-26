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
 * MCP generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * The CLI shares the workspace `mcp_config.json` shape with the IDE
 * (top-level `mcpServers`, `disabledTools` per server) but uses its own global
 * config tree (`~/.gemini/antigravity-cli/mcp_config.json`). The file is
 * dedicated to MCP, so it is safely deletable.
 *
 * - Project scope: `.agents/mcp_config.json`
 * - Global scope: `~/.gemini/antigravity-cli/mcp_config.json`
 */
export class AntigravityCliMcp extends ToolMcp {
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
        relativeDirPath: join(".gemini", "antigravity-cli"),
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
  }: ToolMcpFromFileParams): Promise<AntigravityCliMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new AntigravityCliMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<AntigravityCliMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new AntigravityCliMcp({
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
  }: ToolMcpForDeletionParams): AntigravityCliMcp {
    return new AntigravityCliMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
