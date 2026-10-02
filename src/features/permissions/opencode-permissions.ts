import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { parse as parseJsonc } from "jsonc-parser";
import { z } from "zod/mini";

import { OPENCODE_LAYOUT, type OpencodeLayout } from "../../constants/opencode-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import { ValidationResult } from "../../types/ai-file.js";
import type {
  OpencodePermissionsOverride,
  PermissionAction,
  PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { parseJsonc as parseJsoncStrict } from "../../utils/jsonc.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  collapseRulesToSingleAction,
  hasPatternSpecificRules,
  PERMISSION_ACTION_PRIORITY,
} from "./single-action-collapse.js";
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
type OpencodePermission = z.infer<typeof OpencodePermissionSchema>;

/**
 * OpenCode permission keys whose schema accepts only a single action. Unlike
 * path/command-aware keys such as `bash` and `read`, these keys cannot express
 * per-pattern rules.
 *
 * @see https://opencode.ai/docs/agents/#permissions
 */
const OPENCODE_ACTION_ONLY_PERMISSION_KEYS = new Set([
  "webfetch",
  "websearch",
  "todowrite",
  "question",
  "doom_loop",
]);

function toOpencodePermission({
  category,
  value,
  logger,
}: {
  category: string;
  value: OpencodePermission;
  logger?: Logger;
}): OpencodePermission {
  if (typeof value === "string" || !OPENCODE_ACTION_ONLY_PERMISSION_KEYS.has(category)) {
    return value;
  }

  // The implicit `ask` for a map without a catch-all keeps a narrow allowlist
  // from expanding into blanket `allow` under OpenCode's scalar-only shape.
  const action = collapseRulesToSingleAction({ rules: value });
  if (action === undefined) {
    logger?.warn(
      `OpenCode's "${category}" permission accepts only a single action. Collapsed its empty pattern map to "deny" to avoid falling back to OpenCode's default allow behavior.`,
    );
    return "deny";
  }

  if (hasPatternSpecificRules(value)) {
    logger?.warn(
      `OpenCode's "${category}" permission accepts only a single action. Collapsed its pattern rules to "${action}" using deny > ask > allow precedence.`,
    );
  }

  return action;
}

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

/**
 * Translate between rulesync's canonical permission category names and
 * OpenCode's native permission keys. OpenCode has no `agent` key — subagent
 * launches are gated by the `task` key (see the documented key list at
 * https://opencode.ai/docs/permissions/). Without this translation a canonical
 * `agent: deny` would be written verbatim into `opencode.json` and silently
 * ignored by OpenCode. Unknown names pass through unchanged.
 */
const CANONICAL_TO_OPENCODE_PERMISSION_KEYS: Record<string, string> = {
  agent: "task",
};

const OPENCODE_TO_CANONICAL_PERMISSION_KEYS: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_OPENCODE_PERMISSION_KEYS).map(([canonical, opencode]) => [
    opencode,
    canonical,
  ]),
);

/**
 * Canonical categories folded into another OpenCode key on generate only.
 * OpenCode has no `write` key: its write tool asks for the `edit` permission
 * ("`edit` — file modifications including edit, write, patch"), so a canonical
 * `write` rule is merged into `edit`. The fold is one-way, so an imported
 * `edit` stays the canonical `edit` rather than splitting into two categories.
 *
 * @see https://opencode.ai/docs/permissions/
 */
const CANONICAL_TO_OPENCODE_FOLDED_PERMISSION_KEYS: Record<string, string> = {
  write: "edit",
};

/**
 * Canonical categories OpenCode has no tool for at all. Writing them into
 * `opencode.json` would leave a rule OpenCode validates and never consults, so
 * they are skipped with a warning instead.
 */
const OPENCODE_UNSUPPORTED_PERMISSION_CATEGORIES = new Set(["notebookedit"]);

function toOpencodePermissionKey(canonical: string): string {
  return (
    CANONICAL_TO_OPENCODE_PERMISSION_KEYS[canonical] ??
    CANONICAL_TO_OPENCODE_FOLDED_PERMISSION_KEYS[canonical] ??
    canonical
  );
}

/**
 * Merge two canonical pattern maps that land on the same OpenCode key.
 *
 * OpenCode evaluates a key's patterns in order and the last match wins, so
 * interleaving two maps could let one map's later `allow` shadow the other's
 * `deny`. Identical maps are kept as-is; otherwise each pattern keeps the
 * stricter action and the entries are ordered allow → ask → deny, which makes
 * the result at least as strict as either input for every path (it may be
 * stricter, never looser). The intersection of two ordered glob rule lists is
 * not expressible in general, so the merge fails closed: an `allow` carve-out
 * under a broader `ask`/`deny` pattern no longer takes effect.
 */
function mergePatternRules(
  base: Record<string, PermissionAction>,
  incoming: Record<string, PermissionAction>,
): Record<string, PermissionAction> {
  if (isDeepStrictEqual(Object.entries(base), Object.entries(incoming))) {
    return base;
  }
  const merged: Record<string, PermissionAction> = { ...base };
  for (const [pattern, action] of Object.entries(incoming)) {
    const existing = Object.hasOwn(merged, pattern) ? merged[pattern] : undefined;
    if (
      existing === undefined ||
      PERMISSION_ACTION_PRIORITY[action] > PERMISSION_ACTION_PRIORITY[existing]
    ) {
      merged[pattern] = action;
    }
  }
  return Object.fromEntries(
    Object.entries(merged).toSorted(
      ([, a], [, b]) => PERMISSION_ACTION_PRIORITY[a] - PERMISSION_ACTION_PRIORITY[b],
    ),
  );
}

function toCanonicalPermissionKey(opencodeKey: string): string {
  return OPENCODE_TO_CANONICAL_PERMISSION_KEYS[opencodeKey] ?? opencodeKey;
}

function isSharedPermissionCategory(category: string): boolean {
  // `"*"` is OpenCode's all-tools key and carries a cross-tool meaning in the
  // canonical rulesync model (the string form `"permission": "allow"` normalizes
  // to the same `{ "*": { "*": action } }` shape), so it must stay in the shared
  // block rather than being routed into the OpenCode-only override.
  return (
    category === "*" ||
    CANONICAL_PERMISSION_CATEGORIES.has(category) ||
    category.startsWith("mcp__")
  );
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
  /** Directory layout; OpenCode forks (MiMo Code) override it. */
  protected static readonly layout: OpencodeLayout = OPENCODE_LAYOUT;

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
    return {
      relativeDirPath: global ? this.layout.globalDir : this.layout.configDir,
      relativeFilePath: this.layout.jsonFileName,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<OpencodePermissions> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    const jsoncPath = join(jsonDir, this.layout.jsoncFileName);
    const jsonPath = join(jsonDir, this.layout.jsonFileName);

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = this.layout.jsoncFileName;

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = this.layout.jsonFileName;
      }
    }

    const parsed: unknown = parseJsonc(fileContent ?? "{}");
    const record = isRecord(parsed) ? parsed : {};
    const nextJson = {
      ...record,
      // Read as an own property rather than through the prototype chain:
      // `jsonc-parser` assigns keys with `obj[key] = value`, so a literal
      // `"__proto__": { "permission": ... }` in the config replaces this
      // object's prototype, and `record.permission` would import a permission
      // block that the word "permission" never appears next to in the file.
      permission: Object.hasOwn(record, "permission") ? (record.permission ?? {}) : {},
    };

    return new this({
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
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<OpencodePermissions> {
    const basePaths = this.getSettablePaths({ global });
    const jsonDir = join(outputRoot, basePaths.relativeDirPath);

    const jsoncPath = join(jsonDir, this.layout.jsoncFileName);
    const jsonPath = join(jsonDir, this.layout.jsonFileName);

    let fileContent = await readFileContentOrNull(jsoncPath);
    let relativeFilePath = this.layout.jsoncFileName;

    if (!fileContent) {
      fileContent = await readFileContentOrNull(jsonPath);
      if (fileContent) {
        relativeFilePath = this.layout.jsonFileName;
      }
    }

    const rulesyncJson = rulesyncPermissions.getJson();
    // Merge the shared canonical block with the OpenCode-only override. The
    // override wins per category, so an OpenCode-specific value (e.g. an
    // `external_directory` deny, or a `webfetch` value tuned only for OpenCode)
    // replaces the shared entry without affecting other tools' outputs.
    const overridePermission = rulesyncJson[this.layout.toolTarget]?.permission ?? {};

    // Translate canonical category names into OpenCode's native permission keys
    // (`agent` → `task`, `write` → `edit`) before emitting them, so each rule is
    // written under the key OpenCode actually reads. A folded `write` is merged
    // with any canonical `edit` rules rather than replacing them.
    const sharedPermission: Record<string, Record<string, PermissionAction>> = {};
    for (const [category, value] of Object.entries(
      honorAllToolsOnBash(rulesyncJson.permission ?? {}),
    )) {
      if (OPENCODE_UNSUPPORTED_PERMISSION_CATEGORIES.has(category)) {
        logger?.warn(
          `OpenCode has no permission key for the "${category}" category; its rules were skipped.`,
        );
        continue;
      }
      const key = toOpencodePermissionKey(category);
      const existing = Object.hasOwn(sharedPermission, key) ? sharedPermission[key] : undefined;
      if (existing) {
        const merged = mergePatternRules(existing, value);
        if (merged !== existing) {
          logger?.warn(
            `Several canonical categories map to OpenCode's "${key}" key, so their rules were merged; patterns were reordered allow, ask, deny so no rule set is loosened, which disables an allow carve-out under a broader ask or deny pattern. Set opencode.permission.${key} to control the exact order.`,
          );
        }
        sharedPermission[key] = merged;
      } else {
        sharedPermission[key] = value;
      }
    }

    const permission: Record<string, OpencodePermission> = {};
    for (const [category, value] of Object.entries({
      ...sharedPermission,
      ...overridePermission,
    })) {
      const opencodePermission = toOpencodePermission({ category, value, logger });
      permission[category] = opencodePermission;
    }

    return new this({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "permissions",
        existingContent: fileContent ?? "",
        patch: { permission },
        filePath: join(jsonDir, relativeFilePath),
        logger,
      }),
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
      // Translate OpenCode's native permission keys back into canonical category
      // names (`task` → `agent`) so subagent-launch gating lands in the shared
      // block instead of being treated as an OpenCode-only override.
      const canonicalCategory = toCanonicalPermissionKey(category);
      if (isSharedPermissionCategory(canonicalCategory)) {
        shared[canonicalCategory] = typeof value === "string" ? { "*": value } : value;
      } else {
        overrideOnly[category] = value;
      }
    }

    const json: PermissionsConfig =
      Object.keys(overrideOnly).length > 0
        ? {
            permission: shared,
            [(this.constructor as typeof OpencodePermissions).layout.toolTarget]: {
              permission: overrideOnly,
            },
          }
        : { permission: shared };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(json, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      // Strict JSONC rather than JSON: the config may carry the user's
      // comments, which the gateway preserves on write-back.
      const json = parseJsoncStrict(this.fileContent || "{}");
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
    return new this({
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
