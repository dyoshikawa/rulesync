import { join } from "node:path";

import {
  QODER_DIR,
  QODER_PROJECT_MCP_FILE_NAME,
  QODER_SETTINGS_FILE_NAME,
} from "../../constants/qoder-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  parseSharedConfig,
  sharedConfigFileKey,
} from "../shared/shared-config-gateway.js";
import { RulesyncMcp } from "./rulesync-mcp.js";
import {
  ToolMcp,
  ToolMcpForDeletionParams,
  ToolMcpFromFileParams,
  ToolMcpFromRulesyncMcpParams,
  ToolMcpParams,
  ToolMcpSettablePaths,
} from "./tool-mcp.js";

const EMPTY_MCP_CONFIG = JSON.stringify({ mcpServers: {} }, null, 2);

/**
 * Parse a Qoder MCP file. The user settings file follows the shared-config
 * gateway's fail-closed declaration; the project `.mcp.json` is shared with
 * other agents, so a malformed file or a non-object root is refused rather
 * than being spread into the regenerated file.
 */
function parseQoderMcpConfig({
  fileContent,
  relativePath,
  global,
}: {
  fileContent: string;
  relativePath: string;
  global: boolean;
}): Record<string, unknown> {
  if (global) {
    return parseSharedConfig({
      format: "json",
      fileContent: fileContent || "{}",
      filePath: relativePath,
      invalidRootPolicy: "error",
    });
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent || "{}");
  } catch (error) {
    throw new Error(`Failed to parse Qoder MCP config at ${relativePath}: ${formatError(error)}`, {
      cause: error,
    });
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse Qoder MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * Read Qoder's server map back into the canonical shape. Qoder uses the same
 * `command` / `args` / `env` / `type` / `url` / `headers` spelling rulesync
 * does, so entries pass through with only prototype-pollution keys dropped.
 */
function convertFromQoderFormat(mcpServers: unknown): McpServers {
  if (!isMcpServers(mcpServers)) {
    return {};
  }
  const result: McpServers = {};
  for (const [serverName, serverConfig] of Object.entries(mcpServers)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(serverName) || !isRecord(serverConfig)) continue;
    result[serverName] = omitPrototypePollutionKeys(serverConfig);
  }
  return result;
}

/**
 * Qoder MCP configuration.
 *
 * - Project scope: `.mcp.json` at the project root, documented as the file
 *   "usually committed with the project". It is the same file the
 *   `claudecode` and `commandcode` targets write, so the servers are written
 *   in the same pass-through shape `ClaudecodeMcp` uses: whichever target
 *   generates last leaves byte-identical content. Top-level sibling keys are
 *   kept, and `--delete` may remove the file.
 * - Global scope: the `mcpServers` key of `~/.qoder/settings.json`. That file
 *   holds every other Qoder setting, so the key is merged in place through the
 *   shared-config gateway and the file is never deleted.
 *
 * The per-machine `.qoder/settings.local.json` scope is left to the user.
 *
 * @see https://docs.qoder.com/en/cli/04-extending-qoder-cli/mcp-servers
 */
export class QoderMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json = parseQoderMcpConfig({
      fileContent: this.fileContent,
      relativePath: join(this.relativeDirPath, this.relativeFilePath),
      global: this.global,
    });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Project: `<project>/.mcp.json`; global: `~/.qoder/settings.json` (the
    // processor supplies the home directory as outputRoot in global mode).
    return global
      ? { relativeDirPath: QODER_DIR, relativeFilePath: QODER_SETTINGS_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: QODER_PROJECT_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<QoderMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? EMPTY_MCP_CONFIG;

    return new QoderMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<QoderMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so this stays side-effect-free under
    // `--dry-run`/`--check`; the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? EMPTY_MCP_CONFIG;
    // Use getMcpServers() (not getJson()) so rulesync-only fields are stripped.
    const mcpServers = rulesyncMcp.getMcpServers();

    const fileContent = global
      ? applySharedConfigPatch({
          fileKey: sharedConfigFileKey(paths),
          feature: "mcp",
          existingContent,
          patch: { mcpServers },
          filePath,
        })
      : JSON.stringify(
          {
            ...parseQoderMcpConfig({
              fileContent: existingContent,
              relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
              global,
            }),
            mcpServers,
          },
          null,
          2,
        );

    return new QoderMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromQoderFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): QoderMcp {
    return new QoderMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
