import { join } from "node:path";

import {
  DEVIN_CONFIG_FILE_NAME,
  DEVIN_DIR,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
  DEVIN_MCP_CONFIG_FILE_NAME,
} from "../../constants/devin-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
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
 * MCP generator for Devin Local (native `.devin/` configuration).
 *
 * Since v3000.3 (the Local 3.6 release), Devin reads MCP servers from a
 * dedicated `mcpServers`-keyed config file rather than the shared
 * `config.json`:
 * - Project scope: `.devin/mcp_config.json`
 * - Global scope: `~/.config/devin/mcp_config.json`
 *
 * Legacy `mcpServers` entries left in `config.json` are auto-migrated into
 * the dedicated file on Devin startup, so writing the legacy key would fight
 * the migration. Import still falls back to the legacy `config.json`
 * `mcpServers` key when no dedicated file exists, so pre-v3000.3 repos
 * migrate cleanly. The gitignored `.devin/mcp_config.local.json` override is
 * the user's personal territory and is never read or written.
 *
 * Each server is a stdio entry ({ command, args, env }) or a remote entry
 * ({ serverUrl | url, headers }), and may carry an optional `disabledTools`
 * array.
 *
 * @see https://docs.devin.ai/cli/extensibility/mcp/configuration
 */
export class DevinMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent !== undefined
        ? DevinMcp.parseJsonOrThrow(this.fileContent, this.relativeDirPath, this.relativeFilePath)
        : {};
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  private static parseJsonOrThrow(
    content: string,
    relativeDirPath: string,
    relativeFilePath: string,
  ): Record<string, unknown> {
    try {
      return JSON.parse(content);
    } catch (error) {
      throw new Error(
        `Failed to parse Devin MCP config at ${join(relativeDirPath, relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: DEVIN_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: DEVIN_MCP_CONFIG_FILE_NAME,
      };
    }
    return {
      relativeDirPath: DEVIN_DIR,
      relativeFilePath: DEVIN_MCP_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<DevinMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    let fileContent = await readFileContentOrNull(filePath);

    if (fileContent === null) {
      // Pre-v3000.3 installs kept servers under the `mcpServers` key of the
      // shared config.json; read it as a fallback so existing repos import
      // cleanly before Devin's own auto-migration has run.
      const legacyPath = join(outputRoot, paths.relativeDirPath, DEVIN_CONFIG_FILE_NAME);
      const legacyContent = await readFileContentOrNull(legacyPath);
      if (legacyContent !== null) {
        const legacyJson = this.parseJsonOrThrow(
          legacyContent,
          paths.relativeDirPath,
          DEVIN_CONFIG_FILE_NAME,
        );
        fileContent = JSON.stringify({ mcpServers: legacyJson.mcpServers ?? {} }, null, 2);
      }
    }

    const json = this.parseJsonOrThrow(
      fileContent ?? '{"mcpServers":{}}',
      paths.relativeDirPath,
      paths.relativeFilePath,
    );
    const newJson = { mcpServers: json.mcpServers ?? {} };

    return new DevinMcp({
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
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<DevinMcp> {
    const paths = this.getSettablePaths({ global });

    // Devin's own auto-migration (and `devin mcp add`) writes user servers
    // into this same file, so an unmanaged entry about to be dropped by the
    // whole-file rewrite deserves a heads-up: import it first or move it to
    // the personal mcp_config.local.json, which rulesync never touches.
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readFileContentOrNull(filePath);
    if (existingContent !== null && logger) {
      const existingJson = this.parseJsonOrThrow(
        existingContent,
        paths.relativeDirPath,
        paths.relativeFilePath,
      );
      const existingServers =
        existingJson.mcpServers && typeof existingJson.mcpServers === "object"
          ? Object.keys(existingJson.mcpServers)
          : [];
      const managedServers = new Set(Object.keys(rulesyncMcp.getMcpServers()));
      const dropped = existingServers.filter((name) => !managedServers.has(name));
      if (dropped.length > 0) {
        logger.warn(
          `Devin MCP servers not managed by rulesync will be removed from ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${dropped.join(", ")}. ` +
            `Run 'rulesync import' first to keep them, or move them to mcp_config.local.json.`,
        );
      }
    }

    return new DevinMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      // Use getMcpServers() (not getJson()) so rulesync-only fields and
      // codex-only fields (`envVars`) are stripped before writing the
      // devin config. The dedicated file is MCP-only, so rulesync owns it
      // outright — no shared-config merge is needed.
      fileContent: JSON.stringify({ mcpServers: rulesyncMcp.getMcpServers() }, null, 2),
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
  }: ToolMcpForDeletionParams): DevinMcp {
    return new DevinMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
