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
 * Rename a single field on every MCP server entry, preserving field order and
 * leaving servers that lack the source field untouched.
 */
function renameServerField(servers: unknown, from: string, to: string): Record<string, unknown> {
  if (servers === null || typeof servers !== "object" || Array.isArray(servers)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(servers).map(([name, config]) => {
      if (config === null || typeof config !== "object" || Array.isArray(config)) {
        return [name, config];
      }
      const renamed = Object.fromEntries(
        Object.entries(config).map(([key, value]) => (key === from ? [to, value] : [key, value])),
      );
      return [name, renamed];
    }),
  );
}

/**
 * Antigravity uses `serverUrl` (not the canonical `url`) for HTTP/SSE MCP
 * servers. Convert the canonical shape into Antigravity's on the way out, and
 * back to canonical on the way in, so round-tripping is lossless.
 */
function toAntigravityMcpServers(servers: unknown): Record<string, unknown> {
  return renameServerField(servers, "url", "serverUrl");
}

function toCanonicalMcpServers(servers: unknown): Record<string, unknown> {
  return renameServerField(servers, "serverUrl", "url");
}

/**
 * Shared MCP generator for Google Antigravity (Antigravity 2.0), used by both
 * the IDE and the CLI.
 *
 * Antigravity writes a dedicated `mcp_config.json` whose `mcpServers` map lives
 * at the top level (`disabledTools` per server is supported). Unlike Gemini
 * CLI's shared `settings.json`, this file is dedicated to MCP, so it is safely
 * deletable. HTTP servers use `serverUrl` rather than the canonical `url`, so
 * the field is translated in both directions.
 *
 * The IDE and CLI share the project path (`.agents/mcp_config.json`) and differ
 * only in their global config subdirectory, which each concrete subclass
 * supplies via {@link AntigravityMcp.getGlobalSubdir}.
 */
export class AntigravityMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = JSON.parse(this.fileContent || "{}");
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  /** Global config subdirectory under `~/.gemini/` (`antigravity` | `antigravity-cli`). */
  protected static getGlobalSubdir(): string {
    throw new Error("Please implement this method in the subclass.");
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".gemini", this.getGlobalSubdir()),
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
  }: ToolMcpFromFileParams): Promise<AntigravityMcp> {
    const paths = this.getSettablePaths({ global });
    const fileContent =
      (await readFileContentOrNull(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      )) ?? '{"mcpServers":{}}';
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new this({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<AntigravityMcp> {
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({ mcpServers: {} }, null, 2),
    );
    const json = JSON.parse(fileContent);
    const newJson = { ...json, mcpServers: toAntigravityMcpServers(rulesyncMcp.getMcpServers()) };

    return new this({
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
      fileContent: JSON.stringify(
        { mcpServers: toCanonicalMcpServers(this.json.mcpServers) },
        null,
        2,
      ),
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
  }: ToolMcpForDeletionParams): AntigravityMcp {
    return new this({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
