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
 * MCP generator for the Zed editor.
 *
 * Zed configures MCP servers under the top-level `context_servers` key inside
 * its settings file (`.zed/settings.json` for project, `~/.config/zed/settings.json`
 * for global). That file is also where the ignore feature stores `private_files`,
 * so reads and writes must merge into the existing JSON rather than overwrite it.
 */
export class ZedMcp extends ToolMcp {
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
        relativeDirPath: join(".config", "zed"),
        relativeFilePath: "settings.json",
      };
    }
    return {
      relativeDirPath: ".zed",
      relativeFilePath: "settings.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ZedMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "{}";
    const json = JSON.parse(fileContent);
    const newJson = { ...json, context_servers: json.context_servers ?? {} };

    return new ZedMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
  }: ToolMcpFromRulesyncMcpParams): Promise<ZedMcp> {
    const paths = this.getSettablePaths({ global });

    // Read and preserve any existing settings (e.g. `private_files` written by
    // the ignore feature, or unrelated user settings) before writing MCP servers.
    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      "{}",
    );
    const json = JSON.parse(fileContent);
    // Use getMcpServers() so rulesync-only and codex-only fields are stripped.
    // Zed reads `env`/`headers` as-is, so no env-var reference conversion is needed.
    const newJson = { ...json, context_servers: rulesyncMcp.getMcpServers() };

    return new ZedMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: this.json.context_servers ?? {} }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  /**
   * settings.json is a user-managed file shared with other features
   * (e.g. ignore's `private_files`), so it must not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): ZedMcp {
    return new ZedMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
