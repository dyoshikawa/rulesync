import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import type { AiFileParams } from "../../types/ai-file.js";
import { type ValidationResult } from "../../types/ai-file.js";
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

const KiloPermissionSchema = z.union([
  z.enum(["allow", "ask", "deny"]),
  z.record(z.string(), z.enum(["allow", "ask", "deny"])),
]);

const KiloPermissionsConfigSchema = z.looseObject({
  permission: z.optional(z.record(z.string(), KiloPermissionSchema)),
});

type KiloPermissionsConfig = z.infer<typeof KiloPermissionsConfigSchema>;

const KILO_FILE_NAME = "kilo.jsonc";

export class KiloPermissions extends ToolPermissions {
  private readonly json: KiloPermissionsConfig;

  constructor(params: AiFileParams) {
    super(params);
    this.json = KiloPermissionsConfigSchema.parse(parseJsonc(this.fileContent || "{}"));
  }

  getJson(): KiloPermissionsConfig {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: join(".config", "kilo"), relativeFilePath: KILO_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: KILO_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<KiloPermissions> {
    const basePaths = KiloPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, basePaths.relativeDirPath, basePaths.relativeFilePath);

    const fileContent = await readFileContentOrNull(filePath);

    const parsed = parseJsonc(fileContent ?? "{}");
    const nextJson = { ...parsed, permission: parsed.permission ?? {} };

    return new KiloPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath: basePaths.relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiloPermissions> {
    const basePaths = KiloPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, basePaths.relativeDirPath, basePaths.relativeFilePath);

    const fileContent = await readFileContentOrNull(filePath);
    const parsed = parseJsonc(fileContent ?? "{}");
    const nextJson = {
      ...parsed,
      permission: rulesyncPermissions.getJson().permission,
    };

    return new KiloPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath: basePaths.relativeFilePath,
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
      const json = parseJsonc(this.fileContent || "{}");
      const result = KiloPermissionsConfigSchema.safeParse(json);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Kilo permissions JSON: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiloPermissions {
    return new KiloPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permission: {} }, null, 2),
      validate: false,
    });
  }

  private normalizePermission(
    permission: KiloPermissionsConfig["permission"] | undefined,
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
