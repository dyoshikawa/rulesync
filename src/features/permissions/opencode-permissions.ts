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
import {
  mergeOpencodeConfigValues,
  setOwnEntry,
  toOpencodeV2PermissionRules,
  readOpencodeDotDirConfigLayers,
  warnOpencodeDotDirOverrides,
} from "../opencode-config.js";
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
 * OpenCode V2 matches `webfetch` / `websearch` against the URL / query, so
 * their pattern maps are kept as V2 rules; only an empty map still collapses
 * (to `deny`, rather than emitting no rule and falling through to OpenCode's
 * default allow). The other action-only keys match `*` only, so they collapse
 * to a single action in V2 as in V1.
 */
const OPENCODE_V2_PATTERN_ACTION_KEYS = new Set(["webfetch", "websearch"]);

function collapsesInOpencodeV2({
  category,
  value,
}: {
  category: string;
  value: OpencodePermission;
}): boolean {
  if (typeof value === "string" || !OPENCODE_ACTION_ONLY_PERMISSION_KEYS.has(category)) {
    return false;
  }
  return !OPENCODE_V2_PATTERN_ACTION_KEYS.has(category) || Object.keys(value).length === 0;
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

/**
 * One entry of OpenCode V2's ordered `permissions` array. The last matching
 * entry wins.
 *
 * @see https://opencode.ai/v2/docs/permissions/
 */
const OpencodeV2PermissionRuleSchema = z.looseObject({
  action: z.string(),
  resource: z.string(),
  effect: z.enum(["allow", "ask", "deny"]),
});
type OpencodeV2PermissionRule = z.infer<typeof OpencodeV2PermissionRuleSchema>;

/**
 * OpenCode V2 actions mapped back to the V1 permission keys the import path
 * already translates into canonical categories.
 */
const OPENCODE_V2_TO_V1_PERMISSION_KEYS: Record<string, string> = {
  shell: "bash",
  subagent: "task",
};

/**
 * Folds OpenCode V2's ordered `permissions` array back into the V1 per-key
 * map the import path splits into canonical categories (`shell` → `bash`,
 * `subagent` → `task`). A pattern repeated for one action keeps its last
 * effect, as the last matching V2 rule wins; the relative order of rules
 * across different actions is not representable in the map and is dropped.
 */
function fromOpencodeV2PermissionRules(
  rules: readonly OpencodeV2PermissionRule[],
): Record<string, Record<string, PermissionAction>> {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  for (const { action, resource, effect } of rules) {
    const key = Object.hasOwn(OPENCODE_V2_TO_V1_PERMISSION_KEYS, action)
      ? OPENCODE_V2_TO_V1_PERMISSION_KEYS[action]!
      : action;
    const patterns = Object.hasOwn(permission, key) ? permission[key]! : {};
    // Re-insert so the pattern takes the position of its last occurrence.
    // `setOwnEntry` keeps a `__proto__` action or resource an own key.
    delete patterns[resource];
    setOwnEntry(patterns, resource, effect);
    setOwnEntry(permission, key, patterns);
  }
  return permission;
}

/**
 * Translates the shared canonical permission block into OpenCode's native
 * permission keys (`agent` → `task`, `write` → `edit`), so each rule is
 * written under the key OpenCode actually reads. A folded `write` is merged
 * with any canonical `edit` rules rather than replacing them.
 */
function toOpencodeSharedPermission({
  permission,
  toolTarget,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  toolTarget: string;
  logger?: Logger;
}): Record<string, Record<string, PermissionAction>> {
  const sharedPermission: Record<string, Record<string, PermissionAction>> = {};
  for (const [category, value] of Object.entries(honorAllToolsOnBash(permission))) {
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
          `Several canonical categories map to OpenCode's "${key}" key, so their rules were merged; patterns were reordered allow, ask, deny so no rule set is loosened, which disables an allow carve-out under a broader ask or deny pattern. Set ${toolTarget}.permission.${key} to control the exact order.`,
        );
      }
      // OpenCode flattens every key's rules in object order and the last
      // match wins across keys too (a `*` key also matches `edit`), so the
      // merged map takes the native category's own position, never the
      // folded one's: placing it earlier could let a later key override it.
      if (category === key) {
        delete sharedPermission[key];
      }
      sharedPermission[key] = merged;
    } else {
      sharedPermission[key] = value;
    }
  }
  return sharedPermission;
}

const OpencodePermissionsConfigSchema = z.looseObject({
  // OpenCode accepts either a per-tool object OR a bare top-level string that
  // applies uniformly to every tool (e.g. `"permission": "allow"`).
  // See https://opencode.ai/docs/permissions/ ("You can also set all
  // permissions at once").
  permission: z.optional(
    z.union([z.enum(["allow", "ask", "deny"]), z.record(z.string(), OpencodePermissionSchema)]),
  ),
  // OpenCode V2's ordered rule list (read and written for a V2 layout only).
  permissions: z.optional(z.array(OpencodeV2PermissionRuleSchema)),
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

    // OpenCode merges `.opencode/opencode.json(c)` over the root config, so
    // their permission rules are imported too.
    const overlays = await readOpencodeDotDirConfigLayers({
      outputRoot,
      global,
      layout: this.layout,
    });
    const parsed = overlays
      .map(({ config }): unknown => config)
      .reduce(mergeOpencodeConfigValues, parseJsonc(fileContent ?? "{}"));
    const record = isRecord(parsed) ? parsed : {};
    // Read as an own property rather than through the prototype chain:
    // `jsonc-parser` assigns keys with `obj[key] = value`, so a literal
    // `"__proto__": { "permission": ... }` in the config replaces this
    // object's prototype, and `record.permission` would import a permission
    // block that the word "permission" never appears next to in the file.
    const v1Permission = Object.hasOwn(record, "permission") ? (record.permission ?? {}) : {};
    const { permissions: v2Rules, ...rest } = record;
    const nextJson = {
      ...rest,
      permission: this.mergeV2PermissionRules({ v1Permission, v2Rules }),
    };

    return new this({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify(nextJson, null, 2),
      validate,
    });
  }

  /**
   * For a V2 layout, folds the V2 `permissions` array into the V1 map read
   * from the same config. OpenCode V2 applies the V1 map's rules before the
   * array's, so a key the array touches moves after the V1-only keys, with
   * the array's patterns after (and over) its V1 patterns: otherwise a later
   * V1 key could override a V2 rule that OpenCode V2 evaluates after it.
   */
  private static mergeV2PermissionRules({
    v1Permission,
    v2Rules,
  }: {
    v1Permission: unknown;
    v2Rules: unknown;
  }): unknown {
    if (this.layout.configVersion !== "v2") {
      return v1Permission;
    }
    const parsedRules = z.array(OpencodeV2PermissionRuleSchema).safeParse(v2Rules);
    if (!parsedRules.success || parsedRules.data.length === 0) {
      return v1Permission;
    }
    const fromV2 = fromOpencodeV2PermissionRules(parsedRules.data);
    const merged: Record<string, unknown> = {};
    const v1Map = typeof v1Permission === "string" ? { "*": v1Permission } : v1Permission;
    if (isRecord(v1Map)) {
      for (const [key, value] of Object.entries(v1Map)) {
        setOwnEntry(merged, key, value);
      }
    }
    for (const [key, patterns] of Object.entries(fromV2)) {
      const existing = Object.hasOwn(merged, key) ? merged[key] : undefined;
      const combined: Record<string, unknown> = {};
      const base =
        typeof existing === "string" ? { "*": existing } : isRecord(existing) ? existing : {};
      for (const [resource, effect] of [...Object.entries(base), ...Object.entries(patterns)]) {
        delete combined[resource];
        setOwnEntry(combined, resource, effect);
      }
      delete merged[key];
      setOwnEntry(merged, key, combined);
    }
    return merged;
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

    const sharedPermission = toOpencodeSharedPermission({
      permission: rulesyncJson.permission ?? {},
      toolTarget: this.layout.toolTarget,
      logger,
    });

    const isV2 = this.layout.configVersion === "v2";
    const permission: Record<string, OpencodePermission> = {};
    for (const [category, value] of Object.entries({
      ...sharedPermission,
      ...overridePermission,
    })) {
      permission[category] =
        isV2 && !collapsesInOpencodeV2({ category, value })
          ? value
          : toOpencodePermission({ category, value, logger });
    }

    // OpenCode V2 reads the V1 `permission` map too and applies it before the
    // `permissions` array, so the V2 write retracts the V1 map rather than
    // leaving stale rules in front of the generated ones.
    const patch = isV2
      ? { permissions: toOpencodeV2PermissionRules(permission), permission: undefined }
      : { permission };

    warnOpencodeDotDirOverrides({
      // OpenCode V2 appends an overlay's rules (from either spelling) after
      // the root config's, so they take precedence like a V1 overlay's keys.
      generated: isV2 ? { permission, permissions: patch.permissions } : { permission },
      overlays: await readOpencodeDotDirConfigLayers({ outputRoot, global, layout: this.layout }),
      rootFileName: relativeFilePath,
      logger,
    });

    return new this({
      outputRoot,
      relativeDirPath: basePaths.relativeDirPath,
      relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(basePaths),
        feature: "permissions",
        existingContent: fileContent ?? "",
        patch,
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
