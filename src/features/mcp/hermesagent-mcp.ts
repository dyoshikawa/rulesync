import { join } from "node:path";

import { dump, load } from "js-yaml";

import {
  HERMESAGENT_GLOBAL_DIR,
  HERMESAGENT_MCP_FILE_NAME,
} from "../../constants/hermesagent-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
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

const HERMESAGENT_GLOBAL_ONLY_MESSAGE =
  "Hermes Agent MCP is global-only; use --global to sync ~/.hermes/config.yaml";

function parseHermesConfig(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = load(fileContent);
  } catch (error) {
    throw new Error(`Failed to parse Hermes config at ${configPath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  // An empty config.yaml parses to undefined/null; treat it as an empty object.
  if (parsed === undefined || parsed === null) {
    return {};
  }
  if (!isRecord(parsed)) {
    throw new Error(`Failed to parse Hermes config at ${configPath}: expected a YAML mapping`);
  }
  return parsed;
}

/**
 * Converts rulesync canonical MCP servers into Hermes `mcp_servers:` entries.
 *
 * Hermes follows the MCP spec verbatim (command/args/env for stdio; url/type for
 * http/sse), which matches rulesync's canonical model, so this is a direct
 * passthrough that only filters out prototype-pollution keys and non-object
 * server configs.
 */
function convertToHermesFormat(mcpServers: McpServers): Record<string, Record<string, unknown>> {
  const result: Record<string, Record<string, unknown>> = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    result[name] = config;
  }

  return result;
}

/**
 * Converts Hermes `mcp_servers:` entries back into rulesync canonical MCP servers.
 *
 * Hermes uses the MCP spec verbatim, so import is a direct passthrough mirroring
 * the export above.
 */
function convertFromHermesFormat(mcpServers: Record<string, unknown>): McpServers {
  const result: McpServers = {};

  for (const [name, config] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(name) || !isRecord(config)) continue;
    result[name] = config;
  }

  return result;
}

/**
 * Hermes Agent MCP servers.
 *
 * Hermes Agent configures MCP servers under the top-level `mcp_servers` key of
 * the shared user config file `~/.hermes/config.yaml` (the HERMES_HOME directory;
 * global only — Hermes has no project-scoped MCP location). That file also holds
 * other Hermes settings (model, terminal, ...), so generation merges the
 * `mcp_servers:` block into the existing config instead of overwriting it, and
 * the file is never deleted.
 */
export class HermesagentMcp extends ToolMcp {
  private readonly config: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.config = parseHermesConfig(
        this.fileContent,
        this.relativeDirPath,
        this.relativeFilePath,
      );
    } else {
      this.config = {};
    }
  }

  getConfig(): Record<string, unknown> {
    return this.config;
  }

  override isDeletable(): boolean {
    // config.yaml holds other Hermes settings, so it must never be removed
    // wholesale; clearing MCP happens via an in-place merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      relativeFilePath: HERMESAGENT_MCP_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";

    return new HermesagentMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<HermesagentMcp> {
    if (!global) {
      throw new Error(HERMESAGENT_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      "",
    );
    const config = parseHermesConfig(fileContent, paths.relativeDirPath, paths.relativeFilePath);

    // Merge the `mcp_servers:` block into the shared config, preserving other
    // keys (model, terminal, ...).
    const merged = {
      ...config,
      mcp_servers: convertToHermesFormat(rulesyncMcp.getMcpServers()),
    };

    return new HermesagentMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: dump(merged),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = isRecord(this.config.mcp_servers) ? this.config.mcp_servers : {};
    const servers = convertFromHermesFormat(mcpServers);
    return this.toRulesyncMcpDefault({
      fileContent: JSON.stringify({ mcpServers: servers }, null, 2),
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
  }: ToolMcpForDeletionParams): HermesagentMcp {
    return new HermesagentMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global,
    });
  }
}
