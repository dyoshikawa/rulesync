import { join } from "node:path";

import { CODEBUDDY_DIR, CODEBUDDY_MCP_FILE_NAME } from "../../constants/codebuddy-paths.js";
import { ValidationResult } from "../../types/ai-file.js";
import { isMcpServers, type McpServers } from "../../types/mcp.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc } from "../../utils/jsonc.js";
import {
  omitPrototypePollutionKeys,
  PROTOTYPE_POLLUTION_KEYS,
} from "../../utils/prototype-pollution.js";
import { isPlainObject, isRecord } from "../../utils/type-guards.js";
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
 * Parse a CodeBuddy MCP file. CodeBuddy documents its MCP files as JSONC, so a
 * hand-written file is read tolerating comments and trailing commas; malformed
 * content or a non-object root (`null`, an array, a scalar) fails closed
 * rather than being spread into the regenerated file.
 */
function parseCodebuddyMcpConfig({
  fileContent,
  relativePath,
}: {
  fileContent: string;
  relativePath: string;
}): Record<string, unknown> {
  let parsed: unknown;
  try {
    parsed = parseJsonc(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse CodeBuddy MCP config at ${relativePath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse CodeBuddy MCP config at ${relativePath}: expected a JSON object at the root`,
    );
  }
  return parsed;
}

/**
 * Read CodeBuddy's server map back into the canonical shape. CodeBuddy's
 * per-server keys (`type`, `command`, `args`, `env`, `url`, `headers`,
 * `description`, ...) are already canonical, so entries pass through with
 * only prototype-pollution keys dropped.
 */
function convertFromCodebuddyFormat(mcpServers: unknown): McpServers {
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
 * CodeBuddy Code MCP configuration.
 *
 * CodeBuddy reads `<project>/.mcp.json` (project scope) and
 * `~/.codebuddy/.mcp.json` (user scope), both in the `{ "mcpServers": { ... } }`
 * shape with `type` (`stdio` | `sse` | `http`, inferred from `command` / `url`
 * when absent), `command` / `args` / `env` and `url` / `headers`. The
 * deprecated `mcp.json` names and the legacy `~/.codebuddy.json` are only
 * read by CodeBuddy when the recommended file is absent, so rulesync writes
 * the recommended file and leaves the per-project local scope (the
 * `projects` block of `~/.codebuddy.json`) to the tool.
 *
 * The project `.mcp.json` is the very file the `claudecode` target writes, so
 * servers are written in the same pass-through shape `ClaudecodeMcp` uses:
 * whichever of the two targets generates last leaves byte-identical content.
 * Top-level sibling keys of an existing file (e.g. `disabledMcpServers`) are
 * kept. The global file is not deleted by `--delete` (it lives outside the
 * project), while the project file is rulesync's own and is.
 *
 * @see https://www.codebuddy.ai/docs/cli/mcp
 */
export class CodebuddyMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    this.json =
      this.fileContent === undefined
        ? {}
        : parseCodebuddyMcpConfig({
            fileContent: this.fileContent,
            relativePath: join(this.relativeDirPath, this.relativeFilePath),
          });
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return !this.global;
  }

  static getSettablePaths({ global = false }: { global?: boolean } = {}): ToolMcpSettablePaths {
    // Project: `<project>/.mcp.json`; global: `~/.codebuddy/.mcp.json` (the
    // processor supplies the home directory as outputRoot in global mode).
    return global
      ? { relativeDirPath: CODEBUDDY_DIR, relativeFilePath: CODEBUDDY_MCP_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: CODEBUDDY_MCP_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<CodebuddyMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';

    return new CodebuddyMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<CodebuddyMcp> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);

    // Keep any top-level sibling keys of an existing file; only `mcpServers`
    // is regenerated.
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"mcpServers":{}}';
    const json = parseCodebuddyMcpConfig({
      fileContent,
      relativePath: join(paths.relativeDirPath, paths.relativeFilePath),
    });

    // Use getMcpServers() (not getJson()) so rulesync-only fields are
    // stripped before writing the CodeBuddy config.
    const codebuddyConfig = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new CodebuddyMcp({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(codebuddyConfig, null, 2),
      validate,
      global,
    });
  }

  toRulesyncMcp(): RulesyncMcp {
    const mcpServers = convertFromCodebuddyFormat(this.json.mcpServers);
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
  }: ToolMcpForDeletionParams): CodebuddyMcp {
    return new CodebuddyMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}
