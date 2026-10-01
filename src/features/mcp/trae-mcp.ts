import { join } from "node:path";

import { TRAE_DIR, TRAE_MCP_FILE_NAME } from "../../constants/trae-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContent, readFileContentOrNull } from "../../utils/file.js";
import { warnWithFallback } from "../../utils/logger.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

/** A `${...}` reference Trae does not expand: anything but `${workspaceFolder}`. */
const UNEXPANDED_VARIABLE_REGEX = /\$\{(?!workspaceFolder\})[^}]+\}/;

/**
 * MCP generator for Trae (ByteDance's AI IDE, "TraeCode" in its docs).
 *
 * Trae loads project-level MCP servers from `.trae/mcp.json`, a standard
 * `mcpServers` object: `command` / `args` / `env` for stdio servers and `url` /
 * `headers` for HTTP servers. The only variable it expands is
 * `${workspaceFolder}`, which is passed through untouched. Any other `${...}`
 * reference (e.g. `${API_KEY}`) reaches Trae as literal text, so it is written
 * as is with a warning.
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

  static async fromRulesyncMcp({
    outputRoot = process.cwd(),
    rulesyncMcp,
    validate = true,
    global = false,
    logger,
  }: ToolMcpFromRulesyncMcpParams): Promise<TraeMcp> {
    const paths = this.getSettablePaths({ global });

    // Keep the hand-added top-level keys of an existing .trae/mcp.json, as
    // CursorMcp does; only `mcpServers` is owned by rulesync.
    const existingContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? "{}";
    let json: Record<string, unknown>;
    try {
      json = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse Trae MCP config at ${join(paths.relativeDirPath, paths.relativeFilePath)}: ${formatError(error)}`,
        { cause: error },
      );
    }

    // Use getMcpServers() (not getJson().mcpServers) so rulesync-only fields
    // and codex-only fields (`envVars`) are stripped before writing the Trae
    // config.
    const mcpServers = rulesyncMcp.getMcpServers();
    for (const [serverName, config] of Object.entries(mcpServers)) {
      const values = [...Object.values(config.env ?? {}), ...Object.values(config.headers ?? {})];
      if (values.some((value) => UNEXPANDED_VARIABLE_REGEX.test(value))) {
        warnWithFallback(
          logger,
          `Trae MCP server "${serverName}": Trae expands only \${workspaceFolder}, so other \${...} references in env/headers are passed as literal text.`,
        );
      }
    }

    return new TraeMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify({ ...json, mcpServers }, null, 2),
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
