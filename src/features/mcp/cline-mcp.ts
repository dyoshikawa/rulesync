import { join } from "node:path";

import { CLINE_MCP_DIR_PATH, CLINE_MCP_FILE_NAME } from "../../constants/cline-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const CLINE_GLOBAL_ONLY_MESSAGE =
  "Cline MCP is global-only; use --global to sync ~/.cline/data/settings/cline_mcp_settings.json";

function parseClineSettings(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Cline MCP settings at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error(`Failed to parse Cline MCP settings at ${configPath}: expected a JSON object`);
  }
  return parsed;
}

/**
 * Cline MCP servers.
 *
 * Cline does NOT read a project-scoped MCP file; it reads MCP servers only from
 * a single GLOBAL settings file. The path is resolved by Cline's
 * `resolveMcpSettingsPath()` as
 * `join(resolveClineDataDir(), "settings", "cline_mcp_settings.json")`, where
 * `resolveClineDataDir()` defaults to `~/.cline/data` (overridable via the
 * `CLINE_DATA_DIR` / `CLINE_MCP_SETTINGS_PATH` env vars). The default path is
 * therefore `~/.cline/data/settings/cline_mcp_settings.json`.
 *
 * The settings file may hold other keys, so generation merges the `mcpServers`
 * block into the existing settings instead of overwriting it, and the file is
 * never deleted.
 *
 * @see https://github.com/cline/cline/blob/main/sdk/packages/shared/src/storage/paths.ts
 */
export class ClineMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.json = parseClineSettings(this.fileContent, this.relativeDirPath, this.relativeFilePath);
    } else {
      this.json = {};
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // The global settings file may hold keys other than `mcpServers`, so it is
    // never removed wholesale; clearing MCP happens via an in-place merge.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: CLINE_MCP_DIR_PATH,
      relativeFilePath: CLINE_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<ClineMcp> {
    if (!global) {
      throw new Error(CLINE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const json = parseClineSettings(fileContent, paths.relativeDirPath, paths.relativeFilePath);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new ClineMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<ClineMcp> {
    if (!global) {
      throw new Error(CLINE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({}, null, 2),
    );
    const json = parseClineSettings(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Merge `mcpServers` into the existing settings, preserving other keys.
    const merged = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new ClineMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isMcpServers(this.json.mcpServers) ? this.json.mcpServers : {};
    // Do not spread the full settings JSON: any tool-specific keys must not leak
    // into rulesync mcp.json.
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers }, null, 2),
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
  }: ToolMcpForDeletionParams): ClineMcp {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new ClineMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
