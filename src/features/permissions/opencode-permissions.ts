import { join } from "node:path";

import { parse as parseJsonc, type ParseError } from "jsonc-parser";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import {
  buildRulesyncPermissionsFileContent,
  entriesToPermissionsMap,
  permissionsMapToEntries,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

type OpencodeConfig = Record<string, unknown> & {
  permission?: Record<string, Record<string, PermissionAction>>;
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

    const parseErrors: ParseError[] = [];
    const jsonResult = parseJsonc(fileContent, parseErrors, { disallowComments: false });
    if (parseErrors.length > 0 || !jsonResult || typeof jsonResult !== "object") {
      throw new Error(
        `Failed to parse existing OpenCode config at ${join(
          baseDir,
          basePaths.relativeDirPath,
          relativeFilePath,
        )}: ${formatError(new Error("Invalid JSONC content"))}`,
      );
    }
    const json: OpencodeConfig = jsonResult;

    // Convert canonical → OpenCode format
    const config = rulesyncPermissions.getJson();
    const permission = entriesToPermissionsMap(config.permissions);

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
    const parseErrors: ParseError[] = [];
    const jsonResult = parseJsonc(this.getFileContent(), parseErrors, { disallowComments: false });
    if (parseErrors.length > 0 || !jsonResult || typeof jsonResult !== "object") {
      throw new Error(
        `Failed to parse OpenCode permissions content in ${join(
          this.getRelativeDirPath(),
          this.getRelativeFilePath(),
        )}: ${formatError(new Error("Invalid JSONC content"))}`,
      );
    }
    const json: OpencodeConfig = jsonResult;
    const permission = json.permission ?? {};
    const entries = permissionsMapToEntries(permission);

    return this.toRulesyncPermissionsDefault({
      fileContent: buildRulesyncPermissionsFileContent({ entries }),
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
