import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import { ValidationResult } from "../../types/ai-file.js";
import type { PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const OpencodePermissionSchema = z.union([
  z.enum(["allow", "ask", "deny"]),
  z.record(z.string(), z.enum(["allow", "ask", "deny"])),
]);

const OpencodePermissionsConfigSchema = z.looseObject({
  permission: z.optional(z.record(z.string(), OpencodePermissionSchema)),
});

type OpencodePermissionsConfig = z.infer<typeof OpencodePermissionsConfigSchema>;

export class OpencodePermissions extends ToolPermissions {
  private readonly json: OpencodePermissionsConfig;

  constructor(params: AiFileParams) {
    super(params);
    this.json = OpencodePermissionsConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): OpencodePermissionsConfig {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: join(".config", "opencode"), relativeFilePath: "opencode.json" }
      : { relativeDirPath: ".", relativeFilePath: "opencode.json" };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<OpencodePermissions> {
    const basePaths = OpencodePermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = "opencode.jsonc";

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
      }
    }

    const parsed = parseJsonc(fileContent ?? "{}");
    const nextJson = { ...parsed, permission: parsed.permission ?? {} };

    return new OpencodePermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OpencodePermissions> {
    const basePaths = OpencodePermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    const jsoncPath = join(jsonDir, "opencode.jsonc");
    const jsonPath = join(jsonDir, "opencode.json");

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = "opencode.jsonc";

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = "opencode.json";
      }
    }

    const parsed = parseJsonc(fileContent ?? "{}");
    const nextJson = {
      ...parsed,
      permission: rulesyncPermissions.getJson().permission,
    };

    return new OpencodePermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permission = this.normalizePermission(this.json.permission);
    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      const json = JSON.parse(this.fileContent || "{}");
      const result = OpencodePermissionsConfigSchema.safeParse(json);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse OpenCode permissions JSON: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): OpencodePermissions {
    return new OpencodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permission: {} }, null, 2),
      validate: false,
    });
  }

  private normalizePermission(
    permission: OpencodePermissionsConfig["permission"] | undefined,
  ): PermissionsConfig["permission"] {
    if (!permission) {
      return {};
    }

    return Object.fromEntries(
      Object.entries(permission).map(([tool, value]) => [
        tool,
        typeof value === "string" ? { "*": value } : value,
      ]),
    );
  }
}
