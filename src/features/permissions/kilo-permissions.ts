import { join } from "node:path";

import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
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

/**
 * Parse a JSONC string and throw on syntax errors. The `jsonc-parser` `parse()` function is
 * non-throwing best-effort: invalid input silently yields a partial value (often `undefined`,
 * coerced to `{}` by callers). That behavior would silently drop a user's existing `deny` rules
 * when their `kilo.jsonc` has a typo, so we surface the first parse error as a thrown exception
 * — matching the strict `JSON.parse` behavior used by the Cline/AugmentCode/Qwen permissions
 * implementations.
 */
function parseKiloJsoncStrict(content: string, filePath: string): Record<string, unknown> {
  const errors: ParseError[] = [];
  const parsed = parseJsonc(content, errors, { allowTrailingComma: true });
  const first = errors[0];
  if (first) {
    throw new Error(
      `Failed to parse Kilo Code config at ${filePath}: ${printParseErrorCode(first.error)} at offset ${first.offset}`,
    );
  }
  // Normalize the loosely-typed return of `jsonc-parser` into a record. Non-object roots
  // (`null`, arrays, primitives) are coerced to `{}` so the per-key merge logic in callers does
  // not need to defend against them.
  if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) {
    return parsed;
  }
  return {};
}

/**
 * Extract the patterns associated with `deny` from a Kilo per-tool permission value. The value
 * shape is either a string catch-all (`"allow" | "ask" | "deny"`) or a `{ <pattern>: <action> }`
 * map. Used by the per-key merge in `fromRulesyncPermissions` to detect denies that would be
 * lost by replacing a tool key.
 */
function collectKiloDenyPatterns(value: unknown): string[] {
  if (typeof value === "string") {
    return value === "deny" ? ["*"] : [];
  }
  if (value && typeof value === "object" && !Array.isArray(value)) {
    const patterns: string[] = [];
    for (const [pattern, action] of Object.entries(value)) {
      if (action === "deny") {
        patterns.push(pattern);
      }
    }
    return patterns;
  }
  return [];
}

export class KiloPermissions extends ToolPermissions {
  private readonly json: KiloPermissionsConfig;

  constructor(params: AiFileParams) {
    super(params);
    // Always parse the JSONC payload so consumers can call `getJson()` without re-parsing,
    // but only enforce schema validation when `params.validate !== false` (this matches
    // `RulesyncPermissions` behavior and avoids throwing during `forDeletion` / dry-run /
    // import scenarios where the input may be intentionally permissive).
    const parsed = parseJsonc(this.fileContent || "{}");
    if (params.validate !== false) {
      this.json = KiloPermissionsConfigSchema.parse(parsed);
    } else {
      // Permissive path: do not throw. Use safeParse so we still get a typed value when the input
      // happens to match; otherwise fall back to an empty `permission`. This keeps the public
      // `getJson()` shape stable and avoids `as` type assertions.
      const result = KiloPermissionsConfigSchema.safeParse(parsed);
      this.json = result.success ? result.data : {};
    }
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

    const parsed = parseKiloJsoncStrict(fileContent ?? "{}", filePath);
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
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiloPermissions> {
    const basePaths = KiloPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, basePaths.relativeDirPath, basePaths.relativeFilePath);

    const fileContent = await readFileContentOrNull(filePath);
    const parsed = parseKiloJsoncStrict(fileContent ?? "{}", filePath);

    // Per-key merge:
    // - Tool keys present in rulesync output replace the corresponding key entirely (rulesync is
    //   authoritative for any key it manages — we do not perform per-pattern merge inside a key).
    // - Tool keys present only in the existing `parsed.permission` are preserved as-is so
    //   user-added Kilo-only entries (e.g. a `kilo`-only category not represented in rulesync)
    //   are not silently wiped on regenerate.
    // - When a key is replaced AND the existing one had `deny` rules that disappear from the
    //   regenerated output, an aggregated `logger.warn` enumerates the dropped patterns.
    const parsedPermission = parsed.permission;
    const existingPermission: Record<string, unknown> =
      parsedPermission && typeof parsedPermission === "object" && !Array.isArray(parsedPermission)
        ? { ...parsedPermission }
        : {};
    const rulesyncPermission = rulesyncPermissions.getJson().permission;

    const droppedDenyByKey: Record<string, string[]> = {};
    for (const key of Object.keys(rulesyncPermission)) {
      const previous = existingPermission[key];
      const previousDenyPatterns = collectKiloDenyPatterns(previous);
      const nextDenyPatterns = new Set(collectKiloDenyPatterns(rulesyncPermission[key]));
      const dropped = previousDenyPatterns.filter((p) => !nextDenyPatterns.has(p));
      if (dropped.length > 0) {
        droppedDenyByKey[key] = dropped;
      }
    }

    if (Object.keys(droppedDenyByKey).length > 0) {
      const summary = Object.entries(droppedDenyByKey)
        .map(([key, patterns]) => `${key}: [${patterns.join(", ")}]`)
        .join("; ");
      logger?.warn(
        `WARNING: Kilo permissions regeneration drops existing 'deny' rule(s) because rulesync ` +
          `output owns these tool keys. Dropped — ${summary}. To preserve these denies, add ` +
          `them to '.rulesync/permissions.json'.`,
      );
    }

    const mergedPermission: Record<string, unknown> = { ...existingPermission };
    for (const [key, value] of Object.entries(rulesyncPermission)) {
      mergedPermission[key] = value;
    }

    const nextJson = {
      ...parsed,
      permission: mergedPermission,
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
