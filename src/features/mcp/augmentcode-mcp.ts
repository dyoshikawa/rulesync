import { join } from "node:path";

import {
  AUGMENTCODE_DIR,
  AUGMENTCODE_SETTINGS_FILE_NAME,
} from "../../constants/augmentcode-paths.js";
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

const AUGMENTCODE_GLOBAL_ONLY_MESSAGE =
  "AugmentCode MCP is global-only; use --global to sync ~/.augment/settings.json";

function parseAugmentcodeSettings(
  fileContent: string,
  relativeDirPath: string,
  relativeFilePath: string,
): Record<string, unknown> {
  const configPath = join(relativeDirPath, relativeFilePath);
  let parsed: unknown;
  try {
    parsed = JSON.parse(fileContent);
  } catch (error) {
    throw new Error(
      `Failed to parse AugmentCode settings at ${configPath}: ${formatError(error)}`,
      { cause: error },
    );
  }
  // `isPlainObject` (not `isRecord`) rejects class instances for
  // prototype-pollution hardening; `JSON.parse` always yields a plain object.
  if (!isPlainObject(parsed)) {
    throw new Error(
      `Failed to parse AugmentCode settings at ${configPath}: expected a JSON object`,
    );
  }
  return parsed;
}

/**
 * AugmentCode (Auggie CLI) MCP servers.
 *
 * MCP servers are persisted in the shared user settings file
 * `~/.augment/settings.json` (global only — the docs do not document a
 * project-level MCP location). That same file also holds `hooks` and
 * `toolPermissions`, so generation merges the `mcpServers` block into the
 * existing settings instead of overwriting it, and the file is never deleted.
 *
 * @see https://docs.augmentcode.com/cli/integrations
 */
export class AugmentcodeMcp extends ToolMcp {
  private readonly json: Record<string, unknown>;

  constructor(params: ToolMcpParams) {
    super(params);
    if (this.fileContent !== undefined) {
      this.json = parseAugmentcodeSettings(
        this.fileContent,
        this.relativeDirPath,
        this.relativeFilePath,
      );
    } else {
      this.json = {};
    }
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    // settings.json is shared with the hooks and permissions features, so it
    // must never be removed wholesale; clearing MCP happens via an in-place
    // merge instead.
    return false;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolMcpSettablePaths {
    return {
      relativeDirPath: AUGMENTCODE_DIR,
      relativeFilePath: AUGMENTCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolMcpFromFileParams): Promise<AugmentcodeMcp> {
    if (!global) {
      throw new Error(AUGMENTCODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    const json = parseAugmentcodeSettings(
      fileContent,
      paths.relativeDirPath,
      paths.relativeFilePath,
    );
    const newJson = { ...json, mcpServers: json.mcpServers ?? {} };

    return new AugmentcodeMcp({
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
  }: ToolMcpFromRulesyncMcpParams): Promise<AugmentcodeMcp> {
    if (!global) {
      throw new Error(AUGMENTCODE_GLOBAL_ONLY_MESSAGE);
    }
    const paths = this.getSettablePaths({ global });

    const fileContent = await readOrInitializeFileContent(
      join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      JSON.stringify({}, null, 2),
    );
    const json = parseAugmentcodeSettings(
      fileContent,
      paths.relativeDirPath,
      paths.relativeFilePath,
    );

    // Merge `mcpServers` into the shared settings, preserving other keys
    // (e.g. `hooks`, `toolPermissions`).
    const merged = { ...json, mcpServers: rulesyncMcp.getMcpServers() };

    return new AugmentcodeMcp({
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
    // Do not spread the full settings JSON: tool-specific keys (hooks,
    // toolPermissions, etc.) must not leak into rulesync mcp.json.
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
  }: ToolMcpForDeletionParams): AugmentcodeMcp {
    // The shared settings file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new AugmentcodeMcp({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ mcpServers: {} }, null, 2),
      validate: false,
      global,
    });
  }
}
