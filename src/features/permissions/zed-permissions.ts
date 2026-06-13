import { join } from "node:path";

import { z } from "zod/mini";

import { ZED_DIR, ZED_GLOBAL_DIR, ZED_SETTINGS_FILE_NAME } from "../../constants/zed-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction } from "../../types/permissions.js";
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
  webfetch: "fetch",
  websearch: "search_web",
};

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
      ? { relativeDirPath: ZED_GLOBAL_DIR, relativeFilePath: ZED_SETTINGS_FILE_NAME }
      : { relativeDirPath: ZED_DIR, relativeFilePath: ZED_SETTINGS_FILE_NAME };
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

    const managedTools: Record<string, ZedToolPermission> = {};
    for (const [category, rules] of Object.entries(config.permission)) {
      const tool = buildZedToolPermission(rules);
      if (tool) {
        managedTools[toZedToolName(category)] = tool;
      }
    }

    // Only tools rulesync actually rewrites are "managed" — a category that
    // yields no usable rules must not silently drop an existing user entry.
    const managedToolNames = new Set(Object.keys(managedTools));
    const preservedTools = Object.fromEntries(
      Object.entries(existingTools).filter(([toolName]) => !managedToolNames.has(toolName)),
    );

    const mergedSettings = {
      ...settings,
      agent: {
        ...agent,
        tool_permissions: {
          ...toolPermissions,
          tools: { ...preservedTools, ...managedTools },
        },
      },
    };

    return new ZedPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(mergedSettings, null, 2),
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

    for (const [zedToolName, toolPermission] of Object.entries(tools)) {
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
