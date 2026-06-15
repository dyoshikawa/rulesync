import { join } from "node:path";

import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import {
  AMP_DIR,
  AMP_GLOBAL_DIR,
  AMP_SETTINGS_FILE_NAME,
  AMP_SETTINGS_JSONC_FILE_NAME,
} from "../../constants/amp-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const AMP_MCP_SERVERS_KEY = "amp.mcpServers";

function parseAmpSettingsJsonc(fileContent: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed: unknown = parseJsonc(fileContent || "{}", errors, { allowTrailingComma: true });

  if (errors.length > 0) {
    const details = errors
      .map((error) => `${printParseErrorCode(error.error)} at offset ${error.offset}`)
      .join(", ");
    throw new Error(`Failed to parse Amp settings: ${details}`);
  }

  if (!isRecord(parsed)) {
    throw new Error("Amp settings must be a JSON object");
  }

  return parsed;
}

function filterMcpServers(mcpServers: unknown): Record<string, Record<string, unknown>> {
  const filtered: Record<string, Record<string, unknown>> = {};

  if (!isRecord(mcpServers)) return filtered;

  for (const [name, config] of Object.entries(mcpServers)) {
    if (isPrototypePollutionKey(name) || !isRecord(config)) continue;

    const filteredConfig: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config)) {
      if (isPrototypePollutionKey(key)) continue;
      filteredConfig[key] = value;
    }
    filtered[name] = filteredConfig;
  }

  return filtered;
}

export class AmpMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    // jsonc-parser drops `__proto__`, but `constructor`/`prototype` can remain
    // own keys and must not be copied into generated settings.
    this.json = parseAmpSettingsJsonc(this.fileContent);
  }

  getJson(): Record<string, unknown> {
    return structuredClone(this.json);
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: AMP_GLOBAL_DIR,
        relativeFilePath: AMP_SETTINGS_JSONC_FILE_NAME,
      };
    }
    return {
      relativeDirPath: AMP_DIR,
      relativeFilePath: AMP_SETTINGS_JSONC_FILE_NAME,
    };
  }

  /**
   * Probe `<jsonDir>/settings.jsonc` first, falling back to `settings.json`,
   * so existing user files are read-modified-written in place instead of a
   * fresh `.json` sibling being created next to a hand-authored `.jsonc`.
   * Defaults to `settings.jsonc` when neither file exists.
   */
  private static async resolveSettingsFile(
    jsonDir: string,
  ): Promise<{ fileContent: string | null; relativeFilePath: string }> {
    const jsoncContent = await readFileContentOrNull(join(jsonDir, AMP_SETTINGS_JSONC_FILE_NAME));
    if (jsoncContent !== null) {
      return { fileContent: jsoncContent, relativeFilePath: AMP_SETTINGS_JSONC_FILE_NAME };
    }
    const jsonContent = await readFileContentOrNull(join(jsonDir, AMP_SETTINGS_FILE_NAME));
    if (jsonContent !== null) {
      return { fileContent: jsonContent, relativeFilePath: AMP_SETTINGS_FILE_NAME };
    }
    return { fileContent: null, relativeFilePath: AMP_SETTINGS_JSONC_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<AmpMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    // If neither exists, use default empty config
    const json = fileContent ? parseAmpSettingsJsonc(fileContent) : {};

    // Ensure amp.mcpServers exists
    const mcpServers = json[AMP_MCP_SERVERS_KEY];
    const newJson = { ...json, [AMP_MCP_SERVERS_KEY]: mcpServers ?? {} };

    return new AmpMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
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
  }: ToolMcpFromRulesyncMcpParams): Promise<AmpMcp> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    // If neither exists, use default config
    const json = fileContent ? parseAmpSettingsJsonc(fileContent) : { [AMP_MCP_SERVERS_KEY]: {} };

    const filteredMcpServers = filterMcpServers(rulesyncMcp.getMcpServers());

    const newJson = { ...json, [AMP_MCP_SERVERS_KEY]: filteredMcpServers };

    return new AmpMcp({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const filtered = filterMcpServers(this.json[AMP_MCP_SERVERS_KEY]);

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: filtered }, null, 2),
    });
  }

  validate(): ValidationResult {
    let json: Record<string, unknown>;
    try {
      json = parseAmpSettingsJsonc(this.fileContent);
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(String(error)),
      };
    }

    // Check for prototype pollution keys at top level
    for (const key of Object.keys(json)) {
      if (isPrototypePollutionKey(key)) {
        return {
          success: false,
          error: new Error(`Prototype pollution key "${key}" is not allowed`),
        };
      }
    }

    // Validate amp.mcpServers if present. Server-config fields (`type`, etc.)
    // are intentionally accepted as-is: Amp evolves its transport list
    // upstream and the project convention (`.claude/rules/coding-guidelines.md`)
    // is to keep schemas loose so new fields don't require a rulesync release.
    const mcpServers = json[AMP_MCP_SERVERS_KEY];
    if (mcpServers === undefined) {
      return { success: true, error: null };
    }

    if (!isRecord(mcpServers)) {
      return {
        success: false,
        error: new Error(`${AMP_MCP_SERVERS_KEY} must be a JSON object`),
      };
    }

    for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
      if (isPrototypePollutionKey(serverName)) {
        return {
          success: false,
          error: new Error(
            `Server name "${serverName}" is a prototype pollution key and is not allowed`,
          ),
        };
      }

      if (!isRecord(serverConfig)) {
        return {
          success: false,
          error: new Error(`MCP server "${serverName}" must be a JSON object`),
        };
      }

      for (const key of Object.keys(serverConfig)) {
        if (isPrototypePollutionKey(key)) {
          return {
            success: false,
            error: new Error(
              `Config key "${key}" in server "${serverName}" is a prototype pollution key and is not allowed`,
            ),
          };
        }
      }
    }

    return { success: true, error: null };
  }

  /**
   * settings.json may contain other Amp settings, so it should not be deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolMcpForDeletionParams): AmpMcp {
    // SAFETY: `isDeletable()` returns false, so the orchestrator never writes
    // this `{}` content to disk. If a future refactor drops that guard, this
    // would overwrite the user's entire Amp settings — keep the guard or
    // throw here instead.
    return new AmpMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
