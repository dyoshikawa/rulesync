import { join } from "node:path";

import { uniq } from "es-toolkit";
import { parse as parseJsonc, type ParseError, printParseErrorCode } from "jsonc-parser";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Amp's `"amp.tools.disable"` setting disables tools by name. It accepts a glob
 * `*` (disable everything) and a `builtin:<tool>` prefix (disable only the
 * builtin of that name). It lives in the shared Amp settings file:
 * `.amp/settings.json` (project) and `~/.config/amp/settings.json` (global).
 *
 * Reference: https://ampcode.com/manual ("amp.tools.disable").
 */
const AMP_TOOLS_DISABLE_KEY = "amp.tools.disable";

function parseAmpSettings(fileContent: string): Record<string, unknown> {
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

function toDisableList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value.filter((entry): entry is string => typeof entry === "string");
}

/**
 * Permissions generator for Amp (ampcode).
 *
 * Amp only supports disabling tools (there is no allow/ask surface for the
 * tools list), so rulesync `deny` rules are mapped onto the
 * `"amp.tools.disable"` array. Each disabled tool name is modeled as a rulesync
 * category with a single `{ "*": "deny" }` rule, so glob (`*`) entries and
 * `builtin:` prefixes round-trip verbatim. `allow`/`ask` rules are skipped with
 * a warning since Amp's tools list cannot represent them.
 *
 * The settings file is shared with the MCP feature (`amp.mcpServers`), so reads
 * and writes merge into the existing JSON rather than overwriting it, and the
 * file is never deleted.
 */
export class AmpPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * The settings file may carry other Amp settings (e.g. `amp.mcpServers`), so
   * we never delete it; only the managed `amp.tools.disable` key is rewritten.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: join(".config", "amp"), relativeFilePath: "settings.json" }
      : { relativeDirPath: ".amp", relativeFilePath: "settings.json" };
  }

  /**
   * Probe `<jsonDir>/settings.jsonc` first, falling back to `settings.json`, so
   * an existing user file is read-modified-written in place instead of a fresh
   * sibling being created next to a hand-authored `.jsonc`. Defaults to
   * `settings.json` when neither file exists.
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
    return { fileContent: null, relativeFilePath: "settings.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<AmpPermissions> {
    const basePaths = AmpPermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    const json = fileContent ? parseAmpSettings(fileContent) : {};
    const newJson = {
      ...json,
      [AMP_TOOLS_DISABLE_KEY]: toDisableList(json[AMP_TOOLS_DISABLE_KEY]),
    };

    return new AmpPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<AmpPermissions> {
    const basePaths = AmpPermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);
    const { fileContent, relativeFilePath } = await this.resolveSettingsFile(jsonDir);

    const json = fileContent ? parseAmpSettings(fileContent) : {};

    const config = rulesyncPermissions.getJson();
    const disable = convertRulesyncToAmpDisable(config, logger);

    const newJson = { ...json, [AMP_TOOLS_DISABLE_KEY]: disable };

    return new AmpPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const json = parseAmpSettings(this.getFileContent());
    const config = convertAmpDisableToRulesync(toDisableList(json[AMP_TOOLS_DISABLE_KEY]));

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      const json = parseAmpSettings(this.fileContent);
      const disable = json[AMP_TOOLS_DISABLE_KEY];
      if (disable !== undefined && !Array.isArray(disable)) {
        return {
          success: false,
          error: new Error(`"${AMP_TOOLS_DISABLE_KEY}" must be a JSON array of strings`),
        };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: error instanceof Error ? error : new Error(formatError(error)),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): AmpPermissions {
    return new AmpPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ [AMP_TOOLS_DISABLE_KEY]: [] }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert a rulesync permissions config into Amp's `amp.tools.disable` array.
 *
 * Each tool category is treated as a tool name; a `deny` rule disables it. The
 * category name (including any `builtin:` prefix or `*` glob) is preserved
 * verbatim. `allow`/`ask` rules are skipped with a warning since Amp's tools
 * list can only express "disabled".
 */
function convertRulesyncToAmpDisable(
  config: PermissionsConfig,
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"],
): string[] {
  const disable: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "deny") {
        logger?.warn(
          `Amp's "${AMP_TOOLS_DISABLE_KEY}" only supports disabling tools (deny). ` +
            `Skipping ${action} rule for tool "${category}" (pattern "${pattern}").`,
        );
        continue;
      }
      // The tool name is the category; the `*` pattern means "disable the whole
      // tool". Any non-`*` pattern is forwarded as-is onto the category name so
      // it round-trips, but Amp itself matches on tool name only.
      disable.push(category);
    }
  }

  return uniq(disable.toSorted());
}

/**
 * Convert Amp's `amp.tools.disable` array back into a rulesync permissions
 * config. Each disabled tool name becomes a category with a single
 * `{ "*": "deny" }` rule.
 */
function convertAmpDisableToRulesync(disable: string[]): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  for (const tool of disable) {
    permission[tool] = { "*": "deny" };
  }
  return { permission };
}
