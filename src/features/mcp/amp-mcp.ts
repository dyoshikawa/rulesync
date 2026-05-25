import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import { ValidationResult } from "../../types/ai-file.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
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

export class AmpMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    // Use parseJsonc to preserve __proto__ and other special keys
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    this.json = parseJsonc(this.fileContent || "{}") as Record<string, unknown>;
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolMcpSettablePaths {
    if (global) {
      return {
        relativeDirPath: join(".config", "amp"),
        relativeFilePath: "settings.jsonc",
      };
    }
    return {
      relativeDirPath: ".amp",
      relativeFilePath: "settings.jsonc",
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
    const jsoncContent = await readFileContentOrNull(join(jsonDir, "settings.jsonc"));
    if (jsoncContent !== null) {
      return { fileContent: jsoncContent, relativeFilePath: "settings.jsonc" };
    }
    const jsonContent = await readFileContentOrNull(join(jsonDir, "settings.json"));
    if (jsonContent !== null) {
      return { fileContent: jsonContent, relativeFilePath: "settings.json" };
    }
    return { fileContent: null, relativeFilePath: "settings.jsonc" };
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
    const parsed = fileContent ? parseJsonc(fileContent) : {};
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const json = parsed as Record<string, unknown>;

    // Ensure amp.mcpServers exists
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const mcpServers = json[AMP_MCP_SERVERS_KEY] as Record<string, unknown> | undefined;
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
    const parsed = fileContent ? parseJsonc(fileContent) : { [AMP_MCP_SERVERS_KEY]: {} };
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const json = parsed as Record<string, unknown>;

    // Filter out prototype pollution keys from MCP servers
    const mcpServers = rulesyncMcp.getMcpServers();
    const filteredMcpServers: Record<string, unknown> = {};

    for (const [name, config] of Object.entries(mcpServers)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
      if (!config || typeof config !== "object") continue;

      // Filter out pollution keys from the server config
      const filteredConfig: Record<string, unknown> = {};
      for (const [key, value] of Object.entries(config)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
        filteredConfig[key] = value;
      }
      filteredMcpServers[name] = filteredConfig;
    }

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
    // Filter out prototype pollution keys when converting
    const mcpServers = this.json[AMP_MCP_SERVERS_KEY] ?? {};
    const filtered: Record<string, unknown> = {};

    if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
      for (const [name, config] of Object.entries(mcpServers)) {
        if (PROTOTYPE_POLLUTION_KEYS.has(name)) continue;
        if (!config || typeof config !== "object") continue;

        // Filter out pollution keys from config
        const filteredConfig: Record<string, unknown> = {};
        for (const [key, value] of Object.entries(config)) {
          if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
          filteredConfig[key] = value;
        }
        filtered[name] = filteredConfig;
      }
    }

    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: filtered }, null, 2),
    });
  }

  validate(): ValidationResult {
    // Parse fileContent directly since this.json may not be initialized yet
    // when validate() is called from parent constructor
    const parsed = parseJsonc(this.fileContent || "{}");
    // eslint-disable-next-line no-type-assertion/no-type-assertion
    const json = parsed as Record<string, unknown>;

    // Check for prototype pollution keys at top level
    for (const key of Object.keys(json)) {
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
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
    if (mcpServers && typeof mcpServers === "object" && !Array.isArray(mcpServers)) {
      for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
        // Check server name for pollution keys
        if (PROTOTYPE_POLLUTION_KEYS.has(serverName)) {
          return {
            success: false,
            error: new Error(
              `Server name "${serverName}" is a prototype pollution key and is not allowed`,
            ),
          };
        }

        // Validate server config if it's an object
        if (serverConfig && typeof serverConfig === "object") {
          // Check config keys for pollution
          for (const key of Object.keys(serverConfig)) {
            if (PROTOTYPE_POLLUTION_KEYS.has(key)) {
              return {
                success: false,
                error: new Error(
                  `Config key "${key}" in server "${serverName}" is a prototype pollution key and is not allowed`,
                ),
              };
            }
          }
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
