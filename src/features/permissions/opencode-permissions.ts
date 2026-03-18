import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionEntry } from "../../types/permissions.js";
import { joinPattern, splitPattern } from "../../types/permissions.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// OpenCode permission format: { tool: { pattern: action } }
type OpencodePermission = Record<string, Record<string, PermissionAction>>;

type OpencodeConfig = Record<string, unknown> & {
  permission?: OpencodePermission;
};

// OpenCode uses lowercase tool names identical to canonical names.
// No mapping needed; canonical names are used directly.

/**
 * Resolve the OpenCode config file, preferring .jsonc over .json.
 * Returns the file content and the relative file path that was found.
 */
async function resolveOpencodeConfigFile(
  baseDir: string,
  basePaths: ToolPermissionsSettablePaths,
): Promise<{ fileContent: string | null; relativeFilePath: string }> {
  const jsonDir = join(baseDir, basePaths.relativeDirPath);
  const jsoncPath = join(jsonDir, "opencode.jsonc");
  const jsonPath = join(jsonDir, "opencode.json");

  const jsoncContent = await readFileContentOrNull(jsoncPath);
  if (jsoncContent !== null) {
    return { fileContent: jsoncContent, relativeFilePath: "opencode.jsonc" };
  }

  const jsonContent = await readFileContentOrNull(jsonPath);
  if (jsonContent !== null) {
    return { fileContent: jsonContent, relativeFilePath: "opencode.json" };
  }

  return { fileContent: null, relativeFilePath: "opencode.jsonc" };
}

export class OpencodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return { relativeDirPath: ".", relativeFilePath: "opencode.json" };
  }

  static async fromFile({
    baseDir = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<OpencodePermissions> {
    const basePaths = this.getSettablePaths();
    const { fileContent, relativeFilePath } = await resolveOpencodeConfigFile(baseDir, basePaths);

    return new OpencodePermissions({
      baseDir,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: fileContent ?? "{}",
      validate,
    });
  }

  static async fromRulesyncPermissions({
    baseDir = process.cwd(),
    rulesyncPermissions,
    validate = true,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OpencodePermissions> {
    const basePaths = this.getSettablePaths();
    const { fileContent: existingContent, relativeFilePath } = await resolveOpencodeConfigFile(
      baseDir,
      basePaths,
    );

    const fileContent = existingContent ?? JSON.stringify({}, null, 2);

    const json: OpencodeConfig = parseJsonc(fileContent) ?? {};

    // Convert canonical → OpenCode format
    const config = rulesyncPermissions.getJson();
    const permission: OpencodePermission = {};

    for (const entry of config.permissions) {
      const toolName = entry.tool;
      if (!permission[toolName]) {
        permission[toolName] = {};
      }
      const joined = joinPattern(entry.tool, entry.pattern);
      permission[toolName][joined] = entry.action;
    }

    const newJson = {
      ...json,
      permission,
    };

    return new OpencodePermissions({
      baseDir,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(newJson, null, 2),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const json: OpencodeConfig = parseJsonc(this.getFileContent()) ?? {};
    const permission = json.permission ?? {};
    const entries: PermissionEntry[] = [];

    for (const [toolName, patterns] of Object.entries(permission)) {
      for (const [pattern, action] of Object.entries(patterns)) {
        entries.push({
          tool: toolName,
          pattern: splitPattern(toolName, pattern),
          action,
        });
      }
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permissions: entries }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    baseDir = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): OpencodePermissions {
    return new OpencodePermissions({
      baseDir,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
