import { join } from "node:path";

import { z } from "zod/mini";

import {
  getZedGlobalDir,
  getZedOtherPlatformGlobalDir,
  ZED_DIR,
  ZED_SETTINGS_FILE_NAME,
} from "../../constants/zed-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Zed agent tool-permission action values. Zed uses `confirm` where rulesync's
 * canonical model uses `ask`; `allow`/`deny` are shared.
 */
const ZedPermissionActionSchema = z.enum(["allow", "deny", "confirm"]);
type ZedPermissionAction = z.infer<typeof ZedPermissionActionSchema>;

/** A single Zed permission pattern entry (a regex plus a case-sensitivity flag). */
const ZedPermissionPatternSchema = z.looseObject({
  pattern: z.string(),
  case_sensitive: z.optional(z.boolean()),
});
type ZedPermissionPattern = z.infer<typeof ZedPermissionPatternSchema>;

/** Per-tool permission rules under `agent.tool_permissions.tools.<tool>`. */
const ZedToolPermissionSchema = z.looseObject({
  default: z.optional(ZedPermissionActionSchema),
  always_allow: z.optional(z.array(ZedPermissionPatternSchema)),
  always_deny: z.optional(z.array(ZedPermissionPatternSchema)),
  always_confirm: z.optional(z.array(ZedPermissionPatternSchema)),
});
type ZedToolPermission = z.infer<typeof ZedToolPermissionSchema>;

/** The `agent.tool_permissions` object. */
const ZedToolPermissionsSchema = z.looseObject({
  default: z.optional(ZedPermissionActionSchema),
  tools: z.optional(z.record(z.string(), ZedToolPermissionSchema)),
});

/**
 * Mapping from rulesync canonical tool category names to Zed agent tool names.
 * Unknown names are passed through as-is (e.g. `mcp:<server>:<tool>` keys).
 */
const CANONICAL_TO_ZED_TOOL_NAMES: Record<string, string> = {
  bash: "terminal",
  read: "read_file",
  edit: "edit_file",
  write: "write_file",
  webfetch: "fetch",
  websearch: "search_web",
};

/**
 * Canonical categories whose Zed tool is not permission-gated. Zed's gated list
 * is `terminal`, `edit_file`, `write_file`, `delete_path`, `move_path`,
 * `copy_path`, `create_directory`, `fetch`, `search_web` and `skill`; the
 * read-only tools (`read_file`, `grep`, `find_path`, `list_directory`) sit in
 * Zed's own `EXCLUDED_TOOLS` and never call `decide_permission_from_settings`,
 * so a `tools.<name>` entry for one is config Zed never consults. Zed's real
 * read-denial surface is `private_files`, which the ignore feature owns.
 *
 * @see https://zed.dev/docs/ai/tool-permissions#supported-tools
 */
const ZED_EXCLUDED_CANONICAL_CATEGORIES: ReadonlySet<string> = new Set(["read", "grep", "glob"]);

/** The Zed-side spellings of the same tools, for a category that names one directly. */
const ZED_EXCLUDED_TOOL_NAMES: ReadonlySet<string> = new Set([
  "read_file",
  "grep",
  "find_path",
  "list_directory",
]);

const isZedExcludedCategory = (category: string): boolean =>
  ZED_EXCLUDED_CANONICAL_CATEGORIES.has(category) ||
  ZED_EXCLUDED_TOOL_NAMES.has(toZedToolName(category));

const ZED_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_ZED_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toZedToolName(canonical: string): string {
  return CANONICAL_TO_ZED_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(zedName: string): string {
  return ZED_TO_CANONICAL_TOOL_NAMES[zedName] ?? zedName;
}

const CANONICAL_TO_ZED_ACTION: Record<PermissionAction, ZedPermissionAction> = {
  allow: "allow",
  ask: "confirm",
  deny: "deny",
};

const ZED_TO_CANONICAL_ACTION: Record<ZedPermissionAction, PermissionAction> = {
  allow: "allow",
  confirm: "ask",
  deny: "deny",
};

/**
 * Build a Zed per-tool permission object from a canonical category's rules.
 * The catch-all `*` pattern becomes the per-tool `default`; specific patterns
 * become `always_allow`/`always_deny`/`always_confirm` regex entries. Returns
 * `null` when the category yields no usable rules.
 */
function buildZedToolPermission(rules: Record<string, PermissionAction>): ZedToolPermission | null {
  let defaultAction: ZedPermissionAction | undefined;
  const alwaysAllow: ZedPermissionPattern[] = [];
  const alwaysDeny: ZedPermissionPattern[] = [];
  const alwaysConfirm: ZedPermissionPattern[] = [];

  for (const [pattern, action] of Object.entries(rules)) {
    const zedAction = CANONICAL_TO_ZED_ACTION[action];
    if (pattern === "*") {
      defaultAction = zedAction;
      continue;
    }
    const entry: ZedPermissionPattern = { pattern, case_sensitive: false };
    if (zedAction === "allow") {
      alwaysAllow.push(entry);
    } else if (zedAction === "deny") {
      alwaysDeny.push(entry);
    } else {
      alwaysConfirm.push(entry);
    }
  }

  const tool: ZedToolPermission = {};
  if (defaultAction !== undefined) {
    tool.default = defaultAction;
  }
  if (alwaysAllow.length > 0) {
    tool.always_allow = alwaysAllow;
  }
  if (alwaysDeny.length > 0) {
    tool.always_deny = alwaysDeny;
  }
  if (alwaysConfirm.length > 0) {
    tool.always_confirm = alwaysConfirm;
  }

  return Object.keys(tool).length > 0 ? tool : null;
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * Permissions generator for the Zed editor.
 *
 * Zed maps tool permissions onto `agent.tool_permissions` inside its settings
 * file (`.zed/settings.json` for project, `~/.config/zed/settings.json` for
 * global). That file is shared with the MCP (`context_servers`) and ignore
 * (`private_files`) features, so reads and writes merge into the existing JSON
 * rather than overwriting it, and the file is never deleted.
 */
export class ZedPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * settings.json is a user-managed file shared with other features
   * (e.g. MCP `context_servers`, ignore `private_files`), so it must not be
   * deleted.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return global
      ? { relativeDirPath: getZedGlobalDir(), relativeFilePath: ZED_SETTINGS_FILE_NAME }
      : { relativeDirPath: ZED_DIR, relativeFilePath: ZED_SETTINGS_FILE_NAME };
  }

  /** @see getZedOtherPlatformGlobalDir */
  static getExtraSharedWritePaths({
    global = false,
  }: { global?: boolean } = {}): SharedWritePath[] {
    if (!global) {
      return [];
    }
    return [
      {
        relativeDirPath: getZedOtherPlatformGlobalDir(),
        relativeFilePath: ZED_SETTINGS_FILE_NAME,
      },
    ];
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<ZedPermissions> {
    const paths = ZedPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new ZedPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ZedPermissions> {
    const paths = ZedPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Preserve any existing Zed settings (MCP `context_servers`, ignore
    // `private_files`, unrelated user settings) before writing tool permissions.
    // Read without initializing so this stays side-effect-free (e.g. under
    // `--dry-run`/`--check`); the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Zed settings at ${filePath}: ${formatError(error)}`,
        {
          cause: error,
        },
      );
    }

    const config = rulesyncPermissions.getJson();
    const agent = asRecord(settings.agent);
    const toolPermissions = asRecord(agent.tool_permissions);
    const existingTools = asRecord(toolPermissions.tools);

    // The canonical `*` category is the all-tools catch-all. Zed's counterpart
    // is `agent.tool_permissions.default` (rung 6 of its precedence ladder),
    // not a `tools["*"]` entry — `*` is not a Zed tool name, so writing one
    // produces a rule Zed silently ignores. Only the category's own `*`
    // pattern can be expressed there: Zed's global default carries no pattern
    // list, so pattern-scoped rules in the `*` category are dropped with a
    // warning instead of being emitted as inert config.
    let managedDefault: ZedPermissionAction | undefined;
    const managedTools: Record<string, ZedToolPermission> = {};
    const excludedCategories: string[] = [];
    for (const [category, rules] of Object.entries(config.permission)) {
      if (category === "*") {
        for (const [pattern, action] of Object.entries(rules)) {
          if (pattern === "*") {
            managedDefault = CANONICAL_TO_ZED_ACTION[action];
          } else {
            logger?.warn(
              `Zed permissions: dropping the "*" category rule for pattern "${pattern}" — Zed's global tool-permission default takes no patterns; scope the rule to a tool category instead.`,
            );
          }
        }
        continue;
      }
      if (isZedExcludedCategory(category)) {
        // Only an enforcing rule is worth reporting: Zed leaves these tools
        // ungoverned, which is what an `allow` asked for anyway.
        if (Object.values(rules).some((action) => action === "deny" || action === "ask")) {
          excludedCategories.push(category);
        }
        continue;
      }
      const tool = buildZedToolPermission(rules);
      if (tool) {
        managedTools[toZedToolName(category)] = tool;
      }
    }

    if (excludedCategories.length > 0) {
      logger?.warn(
        `Zed permissions: dropping the ${excludedCategories.map((category) => `"${category}"`).join(", ")} ` +
          `${excludedCategories.length === 1 ? "category" : "categories"} — Zed does not gate its ` +
          `read-only tools, so the entries would never be consulted. Zed's read-denial surface is ` +
          `\`private_files\`, which the ignore feature writes from \`.rulesync/.aiignore\`.`,
      );
    }

    // Only tools rulesync actually rewrites are "managed" — a category that
    // yields no usable rules must not silently drop an existing user entry.
    // A canonical `*` category also claims the inert `tools["*"]` entry older
    // rulesync versions wrote for it, so the stale spelling is cleaned up.
    const managedToolNames = new Set(Object.keys(managedTools));
    if ("*" in config.permission) {
      managedToolNames.add("*");
    }
    // An inert `tools.read_file`/`tools.grep` entry an earlier rulesync version
    // wrote is deliberately NOT swept up here: unlike `tools["*"]`, those are
    // real Zed tool names, so an entry could equally be the user's own — and
    // since Zed never consults it either way, leaving it costs nothing while
    // deleting it could not be undone. Import still reads it back.
    const preservedTools = Object.fromEntries(
      Object.entries(existingTools).filter(([toolName]) => !managedToolNames.has(toolName)),
    );

    return new ZedPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          agent: {
            ...agent,
            tool_permissions: {
              ...toolPermissions,
              // Canonical `*` sets the global default; when canonical says
              // nothing, an existing user-set default survives via the spread.
              ...(managedDefault !== undefined && { default: managedDefault }),
              tools: { ...preservedTools, ...managedTools },
            },
          },
        },
        filePath,
      }),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: Record<string, unknown>;
    try {
      settings = JSON.parse(this.getFileContent() || "{}");
    } catch (error) {
      throw new Error(
        `Failed to parse Zed permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const toolPermissionsRaw = asRecord(settings.agent).tool_permissions;
    const parsed = ZedToolPermissionsSchema.safeParse(toolPermissionsRaw ?? {});
    const tools = parsed.success ? (parsed.data.tools ?? {}) : {};
    const globalDefault = parsed.success ? parsed.data.default : undefined;

    const permission: Record<string, Record<string, PermissionAction>> = {};
    const ensure = (category: string): Record<string, PermissionAction> => {
      const existing = permission[category];
      if (existing) {
        return existing;
      }
      const created: Record<string, PermissionAction> = {};
      permission[category] = created;
      return created;
    };

    // The write-side inverse: `agent.tool_permissions.default` is the
    // canonical `*` category's own `*` rule.
    if (globalDefault !== undefined) {
      ensure("*")["*"] = ZED_TO_CANONICAL_ACTION[globalDefault];
    }

    for (const [zedToolName, toolPermission] of Object.entries(tools)) {
      // `*` is not a Zed tool name, so a `tools["*"]` entry (written by an
      // earlier rulesync version) is one Zed ignores. It maps to the same
      // canonical slot as the top-level `default` above, so it is read only
      // when no enforced default exists — the value Zed actually enforces
      // must not lose to the one it ignores.
      if (zedToolName === "*") {
        if (globalDefault === undefined && toolPermission.default !== undefined) {
          ensure("*")["*"] = ZED_TO_CANONICAL_ACTION[toolPermission.default];
        }
        continue;
      }
      const category = toCanonicalToolName(zedToolName);
      if (toolPermission.default !== undefined) {
        ensure(category)["*"] = ZED_TO_CANONICAL_ACTION[toolPermission.default];
      }
      for (const entry of toolPermission.always_allow ?? []) {
        ensure(category)[entry.pattern] = "allow";
      }
      for (const entry of toolPermission.always_deny ?? []) {
        ensure(category)[entry.pattern] = "deny";
      }
      for (const entry of toolPermission.always_confirm ?? []) {
        ensure(category)[entry.pattern] = "ask";
      }
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ZedPermissions {
    return new ZedPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}
