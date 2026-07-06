import { join } from "node:path";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import {
  OPENCODE_GLOBAL_DIR,
  OPENCODE_JSON_FILE_NAME,
  OPENCODE_JSONC_FILE_NAME,
} from "../../constants/opencode-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import { ValidationResult } from "../../types/ai-file.js";
import type {
  OpencodePermissionsOverride,
  PermissionAction,
  PermissionsConfig,
} from "../../types/permissions.js";
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

/**
 * Canonical rulesync permission categories that carry a cross-tool meaning (see
 * the "Supported tool categories" list in `docs/reference/file-formats.md`).
 * On import, any OpenCode category outside this set — plus MCP tool names — is
 * treated as OpenCode-only and routed into the `opencode` override block so a
 * subsequent `rulesync generate` does not leak it into other tools' configs.
 */
const CANONICAL_PERMISSION_CATEGORIES = new Set([
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

function isSharedPermissionCategory(category: string): boolean {
  return CANONICAL_PERMISSION_CATEGORIES.has(category) || category.startsWith("mcp__");
}

const OpencodePermissionsConfigSchema = z.looseObject({
  // OpenCode accepts either a per-tool object OR a bare top-level string that
  // applies uniformly to every tool (e.g. `"permission": "allow"`).
  // See https://opencode.ai/docs/permissions/ ("You can also set all
  // permissions at once").
  permission: z.optional(
    z.union([z.enum(["allow", "ask", "deny"]), z.record(z.string(), OpencodePermissionSchema)]),
  ),
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
      ? { relativeDirPath: OPENCODE_GLOBAL_DIR, relativeFilePath: OPENCODE_JSON_FILE_NAME }
      : { relativeDirPath: ".", relativeFilePath: OPENCODE_JSON_FILE_NAME };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<OpencodePermissions> {
    const basePaths = OpencodePermissions.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
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

    const jsoncPath = join(jsonDir, OPENCODE_JSONC_FILE_NAME);
    const jsonPath = join(jsonDir, OPENCODE_JSON_FILE_NAME);

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = OPENCODE_JSONC_FILE_NAME;

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = OPENCODE_JSON_FILE_NAME;
      }
    }

    const parsed = parseJsonc(fileContent ?? "{}");
    const rulesyncJson = rulesyncPermissions.getJson();
    // Merge the shared canonical block with the OpenCode-only override. The
    // override wins per category, so an OpenCode-specific value (e.g. an
    // `external_directory` deny, or a `webfetch` value tuned only for OpenCode)
    // replaces the shared entry without affecting other tools' outputs.
    const overridePermission = rulesyncJson.opencode?.permission ?? {};
    const nextJson = {
      ...parsed,
      permission: { ...rulesyncJson.permission, ...overridePermission },
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
    const rawPermission = this.json.permission;

    // Top-level uniform string form (`"permission": "allow"`) or an empty config:
    // keep the existing all-tools wildcard behavior, with nothing to route into
    // the OpenCode override.
    if (rawPermission === undefined || typeof rawPermission === "string") {
      const permission = this.normalizePermission(rawPermission);
      return this.toRulesyncPermissionsDefault({
        fileContent: JSON.stringify({ permission }, null, 2),
      });
    }

    // Object form: split categories into the shared canonical block and the
    // OpenCode-only override. Shared categories are normalized into the canonical
    // pattern-to-action shape; OpenCode-only categories keep their original shape
    // (bare action string or pattern map) so the round-trip stays stable.
    const shared: PermissionsConfig["permission"] = {};
    const overrideOnly: NonNullable<OpencodePermissionsOverride["permission"]> = {};
    for (const [category, value] of Object.entries(rawPermission)) {
      if (isSharedPermissionCategory(category)) {
        shared[category] = typeof value === "string" ? { "*": value } : value;
      } else {
        overrideOnly[category] = value;
      }
    }

    const json: PermissionsConfig =
      Object.keys(overrideOnly).length > 0
        ? { permission: shared, opencode: { permission: overrideOnly } }
        : { permission: shared };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(json, null, 2),
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

  /**
   * Normalize the uniform/undefined forms of OpenCode's `permission` field into
   * the canonical rulesync shape. The object form is handled directly in
   * `toRulesyncPermissions` (it needs to split shared vs OpenCode-only
   * categories), so this only covers the two remaining cases.
   */
  private normalizePermission(
    permission: PermissionAction | undefined,
  ): PermissionsConfig["permission"] {
    if (!permission) {
      return {};
    }

    // Top-level uniform string form (`"permission": "allow"`): OpenCode applies
    // it to every tool. The canonical rulesync model represents "all tools /
    // all inputs" with the wildcard tool key `"*"` and the wildcard glob `"*"`,
    // matching how OpenCode's own object syntax uses `"*"` as the all-tools key.
    return { "*": { "*": permission } };
  }
}
