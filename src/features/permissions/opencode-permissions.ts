import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionEntry } from "../../types/permissions.js";
import {
  CANONICAL_TO_OPENCODE_TOOL_NAMES,
  joinPattern,
  splitPattern,
} from "../../types/permissions.js";
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

// Reverse mapping: OpenCode tool name → canonical
const OPENCODE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_OPENCODE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toOpencodeToolName(canonicalTool: string): string {
  return CANONICAL_TO_OPENCODE_TOOL_NAMES[canonicalTool] ?? canonicalTool;
}

function fromOpencodeToolName(opencodeTool: string): string {
  return OPENCODE_TO_CANONICAL_TOOL_NAMES[opencodeTool] ?? opencodeTool;
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
    const jsonDir = join(baseDir, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = "opencode.jsonc";

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
      }
    }

    const fileContentToUse = fileContent ?? "{}";

    return new OpencodePermissions({
      baseDir,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: fileContentToUse,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    baseDir = process.cwd(),
    rulesyncPermissions,
    validate = true,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OpencodePermissions> {
    const basePaths = this.getSettablePaths();
    const jsonDir = join(baseDir, basePaths.relativeDirPath);

    let fileContent: string | null = null;
    let relativeFilePath = "opencode.jsonc";

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    fileContent = await readFileContentOrNull(jsoncPath);
    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
      }
    }

    if (!fileContent) {
      fileContent = JSON.stringify({}, null, 2);
    }

    const json: OpencodeConfig = parseJsonc(fileContent) ?? {};

    // Convert canonical → OpenCode format
    const config = rulesyncPermissions.getJson();
    const permission: OpencodePermission = {};

    for (const entry of config.permissions) {
      const toolName = toOpencodeToolName(entry.tool);
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
      const canonicalTool = fromOpencodeToolName(toolName);
      for (const [pattern, action] of Object.entries(patterns)) {
        entries.push({
          tool: canonicalTool,
          pattern: splitPattern(canonicalTool, pattern),
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
