import { join } from "node:path";

import { type ParseError, parse as parseJsonc, printParseErrorCode } from "jsonc-parser";
import { z } from "zod/mini";

import {
  KILO_DIR,
  KILO_GLOBAL_DIR,
  KILO_JSON_FILE_NAME,
  KILO_JSONC_FILE_NAME,
} from "../../constants/kilo-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import { type ValidationResult } from "../../types/ai-file.js";
import type { KiloPermissionsOverride, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isPlainObject } from "../../utils/type-guards.js";
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
  // The sandbox block Kilo runs commands in. Loose because upstream documents
  // `enabled`/`network`/`allowed_hosts`/`writable_paths` but keeps adding to it.
  sandbox: z.optional(z.looseObject({})),
});

type KiloPermissionsConfig = z.infer<typeof KiloPermissionsConfigSchema>;

/**
 * Kilo permission keys that share a name with a canonical rulesync category and
 * therefore stay in the shared `permission` block. Everything else (Kilo-only
 * keys such as `external_directory`, `doom_loop`, `notebook_edit`, ...) is
 * routed into the `kilo` override on import so it does not leak into other
 * tools' configs. Kilo folds `write` into `edit`, uses `notebook_edit`/`task`
 * rather than the canonical `notebookedit`/`agent`, and has no `mcp` key (MCP is
 * addressed via `mcp__*` tool-name keys), so those canonical names are not Kilo
 * keys in practice — they simply never appear on the shared side.
 */
const KILO_SHARED_CATEGORIES = new Set([
  "bash",
  "read",
  "edit",
  "write",
  "webfetch",
  "websearch",
  "grep",
  "glob",
  "notebookedit",
  "agent",
]);

function isSharedKiloCategory(key: string): boolean {
  return key === "*" || KILO_SHARED_CATEGORIES.has(key) || key.startsWith("mcp__");
}

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

function asKiloRecord(value: unknown): Record<string, unknown> {
  return isPlainObject(value) ? { ...value } : {};
}

/**
 * The `sandbox` keys a *project* `kilo.jsonc` may state. Kilo honors
 * `allowed_hosts` and `writable_paths` from the global config only, and lets a
 * project config merely tighten — so writing the wider keys into a project file
 * would produce config Kilo ignores.
 * @see https://kilo.ai/docs/getting-started/settings/sandboxing
 */
const KILO_PROJECT_SCOPE_SANDBOX_KEYS = new Set(["enabled", "network"]);

function narrowSandboxToProjectScope({
  authored,
  logger,
}: {
  authored: Record<string, unknown>;
  logger?: Logger | undefined;
}): Record<string, unknown> {
  const emitted: Record<string, unknown> = {};
  const dropped: string[] = [];
  for (const [key, value] of Object.entries(authored)) {
    if (KILO_PROJECT_SCOPE_SANDBOX_KEYS.has(key)) {
      emitted[key] = value;
    } else {
      dropped.push(key);
    }
  }
  if (dropped.length > 0) {
    logger?.warn(
      `Kilo honors these 'sandbox' keys from the global config only, so they were dropped from ` +
        `the project config: ${dropped.toSorted().join(", ")}. A project config may only tighten ` +
        `the sandbox ('enabled', 'network'); generate with --global to author the rest.`,
    );
  }
  return emitted;
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
      ? { relativeDirPath: KILO_GLOBAL_DIR, relativeFilePath: KILO_JSONC_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: KILO_JSONC_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<KiloPermissions> {
    const { fileContent, filePath, relativeDirPath, relativeFilePath } =
      await KiloPermissions.resolveImportConfig({ outputRoot, global });

    const parsed = parseKiloJsoncStrict(fileContent ?? "{}", filePath);
    const nextJson = { ...parsed, permission: parsed.permission ?? {} };

    return new KiloPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate,
    });
  }

  /**
   * Resolve the config file to import permissions from, probing in priority order:
   *   1. project root `kilo.jsonc` / `kilo.json` (or the global `.config/kilo`
   *      directory in global mode), then
   *   2. the alternative project location `.kilo/kilo.jsonc` / `.kilo/kilo.json`.
   *
   * Kilo accepts project config at the root OR under `.kilo/`, so the import side
   * probes both. The write side intentionally stays at the root location returned
   * by `getSettablePaths`.
   * https://kilo.ai/docs/automate/mcp/using-in-kilo-code
   */
  private static async resolveImportConfig({
    outputRoot,
    global,
  }: {
    outputRoot: string;
    global: boolean;
  }): Promise<{
    fileContent: string | null;
    filePath: string;
    relativeDirPath: string;
    relativeFilePath: string;
  }> {
    const rootDirPath = KiloPermissions.getSettablePaths({ global }).relativeDirPath;
    // The alternative `.kilo/` project location only applies to project scope.
    const candidateDirPaths = global ? [rootDirPath] : [rootDirPath, KILO_DIR];

    for (const relativeDirPath of candidateDirPaths) {
      for (const relativeFilePath of [KILO_JSONC_FILE_NAME, KILO_JSON_FILE_NAME]) {
        const filePath = join(outputRoot, relativeDirPath, relativeFilePath);
        const fileContent = await readFileContentOrNull(filePath);
        if (fileContent !== null) {
          return { fileContent, filePath, relativeDirPath, relativeFilePath };
        }
      }
    }

    // Nothing found: fall back to the root JSONC path for the (empty) result.
    return {
      fileContent: null,
      filePath: join(outputRoot, rootDirPath, KILO_JSONC_FILE_NAME),
      relativeDirPath: rootDirPath,
      relativeFilePath: KILO_JSONC_FILE_NAME,
    };
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
    const rulesyncJson = rulesyncPermissions.getJson();

    // The full set of keys rulesync owns this generation: the shared `permission`
    // block plus the Kilo-scoped override (override wins per key). Overlaying the
    // override here is what makes Kilo-only keys (external_directory, doom_loop,
    // notebook_edit, ...) authorable from rulesync rather than only pass-through.
    const kiloOverride = rulesyncJson.kilo;
    const incomingPermission: Record<string, unknown> = {
      ...rulesyncJson.permission,
      ...kiloOverride?.permission,
    };

    // Detect `deny` patterns that disappear from any key rulesync now owns —
    // including override keys — so a regenerate that silently weakens a
    // previously-denied surface is surfaced (fail-closed convention).
    const droppedDenyByKey: Record<string, string[]> = {};
    for (const [key, value] of Object.entries(incomingPermission)) {
      const previousDenyPatterns = collectKiloDenyPatterns(existingPermission[key]);
      const nextDenyPatterns = new Set(collectKiloDenyPatterns(value));
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
          `them to '.rulesync/permissions.jsonc'.`,
      );
    }

    const mergedPermission: Record<string, unknown> = {
      ...existingPermission,
      ...incomingPermission,
    };

    const nextJson: Record<string, unknown> = {
      ...parsed,
      permission: mergedPermission,
    };

    // Overlay the Kilo-scoped override's `sandbox` block. Shallow merged at the
    // block's top level, so the override's keys win while unrelated sibling
    // keys the user set directly are preserved.
    if (kiloOverride?.sandbox !== undefined) {
      const authored = asKiloRecord(kiloOverride.sandbox);
      const emitted = global ? authored : narrowSandboxToProjectScope({ authored, logger });
      nextJson.sandbox = { ...asKiloRecord(parsed.sandbox), ...emitted };
    }

    return new KiloPermissions({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath: basePaths.relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const rawPermission = this.json.permission ?? {};

    // Split Kilo keys into the shared canonical block and the Kilo-only override.
    // Shared keys are normalized into the canonical pattern-to-action shape;
    // Kilo-only keys keep their original shape (bare action string or pattern
    // map) under the `kilo` override so a subsequent generate does not leak them
    // into other tools' configs.
    const shared: PermissionsConfig["permission"] = {};
    const overrideOnly: NonNullable<KiloPermissionsOverride["permission"]> = {};
    for (const [key, value] of Object.entries(rawPermission)) {
      if (isSharedKiloCategory(key)) {
        shared[key] = typeof value === "string" ? { "*": value } : value;
      } else {
        overrideOnly[key] = value;
      }
    }

    // `sandbox` is a dedicated security surface with no canonical category, so
    // the whole block round-trips into the Kilo-scoped override. It is
    // tool-scoped, so unlike a canonical field it cannot leak into another
    // tool's config.
    const sandbox = this.json.sandbox;
    const override: KiloPermissionsOverride = {
      ...(Object.keys(overrideOnly).length > 0 && { permission: overrideOnly }),
      ...(isPlainObject(sandbox) && { sandbox }),
    };

    const json: PermissionsConfig =
      Object.keys(override).length > 0
        ? { permission: shared, kilo: override }
        : { permission: shared };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(json, null, 2),
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
}
