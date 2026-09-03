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
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { isPlainObject } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { honorAllToolsOnBash } from "./shell-command-categories.js";
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

/** Canonical per-tool MCP category prefix: `mcp__<server>__<tool>`. */
const MCP_CANONICAL_PREFIX = "mcp__";

/** Zed's per-tool MCP name prefix: `mcp:<server>:<tool>`. */
const MCP_ZED_PREFIX = "mcp:";

/**
 * Mapping from rulesync canonical tool category names to Zed agent tool names.
 * Unknown names are passed through as-is.
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

/**
 * Zed addresses an MCP tool as `mcp:<server>:<tool>`, where rulesync's canonical
 * category is `mcp__<server>__<tool>`. Without this translation the canonical
 * spelling lands under a key Zed never looks up.
 *
 * Only the FIRST separator is split, matching the `cursor-permissions.ts`
 * precedent: upstream's `mcp_tool_id` concatenates the two names without
 * escaping either, so a tool called `create__issue` is legitimately
 * `mcp:github:create__issue`. Splitting every separator would rewrite that into
 * a third key on the next generate.
 *
 * @see https://zed.dev/docs/ai/tool-permissions
 */
function toZedToolName(canonical: string): string {
  if (canonical.startsWith(MCP_CANONICAL_PREFIX)) {
    const [server, ...toolParts] = canonical.slice(MCP_CANONICAL_PREFIX.length).split("__");
    const address = toolParts.length > 0 ? `${server}:${toolParts.join("__")}` : (server ?? "");
    return `${MCP_ZED_PREFIX}${address}`;
  }
  return CANONICAL_TO_ZED_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(zedName: string): string {
  if (zedName.startsWith(MCP_ZED_PREFIX)) {
    const [server, ...toolParts] = zedName.slice(MCP_ZED_PREFIX.length).split(":");
    const address = toolParts.length > 0 ? `${server}__${toolParts.join(":")}` : (server ?? "");
    return `${MCP_CANONICAL_PREFIX}${address}`;
  }
  return ZED_TO_CANONICAL_TOOL_NAMES[zedName] ?? zedName;
}

/**
 * Zed matches `always_allow`/`always_deny`/`always_confirm` regexes against the
 * tool's text input, and it dispatches every MCP tool with a single empty input
 * (`&[String::new()]`, commented upstream as "MCP tools are gated only by tool
 * id (no per-input pattern matching)"). The regexes still run, but against `""`,
 * so a pattern-scoped rule silently does something other than what its author
 * meant — and a non-matching `always_allow` downgrades the outcome to confirm.
 * Only the category's `*` rule (Zed's per-tool `default`) is therefore emitted.
 */
const isMcpZedToolName = (zedName: string): boolean => zedName.startsWith(MCP_ZED_PREFIX);

/**
 * Zed looks a tool up by exact key on the full `mcp:<server>:<tool>` triple, so
 * an address is inert unless it names both a concrete server and a concrete
 * tool: a missing half matches nothing, and so does a wildcard, since Zed does
 * no glob or prefix matching on the key.
 */
function isInertMcpAddress(zedToolName: string): boolean {
  if (!isMcpZedToolName(zedToolName)) return false;
  const [server, ...toolParts] = zedToolName.slice(MCP_ZED_PREFIX.length).split(":");
  const tool = toolParts.join(":");
  return !server || server === "*" || !tool || tool === "*";
}

/**
 * Strip pattern-scoped rules from an MCP category, warning once about the ones
 * dropped. Non-MCP categories are returned untouched.
 */
function withoutInertMcpPatterns({
  category,
  zedToolName,
  rules,
  logger,
}: {
  category: string;
  zedToolName: string;
  rules: Record<string, PermissionAction>;
  logger?: { warn: (message: string) => void };
}): Record<string, PermissionAction> {
  if (!isMcpZedToolName(zedToolName)) return rules;

  const scopedPatterns = Object.keys(rules).filter((pattern) => pattern !== "*");
  if (scopedPatterns.length === 0) return rules;

  logger?.warn(
    `Zed permissions: dropping the pattern-scoped rule(s) ${scopedPatterns.map((pattern) => `"${pattern}"`).join(", ")} ` +
      `in the "${category}" category — Zed dispatches an MCP tool with an empty input, so a permission ` +
      `pattern is matched against "" rather than against anything meaningful. Only the catch-all "*" ` +
      `rule is emitted, as the tool's default.`,
  );
  return Object.fromEntries(Object.entries(rules).filter(([pattern]) => pattern === "*"));
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

/**
 * Split a canonical permission block into the Zed shapes it maps onto, plus the
 * categories the caller should report as dropped.
 *
 * The canonical `*` category is the all-tools catch-all. Zed's counterpart is
 * `agent.tool_permissions.default` (rung 6 of its precedence ladder), not a
 * `tools["*"]` entry — `*` is not a Zed tool name, so writing one produces a
 * rule Zed silently ignores. Only the category's own `*` pattern can be
 * expressed there: Zed's global default carries no pattern list, so
 * pattern-scoped rules in the `*` category are dropped with a warning instead of
 * being emitted as inert config.
 */
function buildZedToolPermissions({
  permission,
  logger,
}: {
  permission: Record<string, Record<string, PermissionAction>>;
  logger?: { warn: (message: string) => void };
}): {
  managedDefault: ZedPermissionAction | undefined;
  managedTools: Record<string, ZedToolPermission>;
  excludedCategories: string[];
  inertMcpCategories: string[];
} {
  let managedDefault: ZedPermissionAction | undefined;
  const managedTools: Record<string, ZedToolPermission> = {};
  const excludedCategories: string[] = [];
  const inertMcpCategories: string[] = [];

  for (const [category, rules] of Object.entries(permission)) {
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
    const zedToolName = toZedToolName(category);
    if (isInertMcpAddress(zedToolName)) {
      inertMcpCategories.push(category);
      continue;
    }
    const tool = buildZedToolPermission(
      withoutInertMcpPatterns({ category, zedToolName, rules, logger }),
    );
    if (tool) {
      managedTools[zedToolName] = tool;
    }
  }

  return { managedDefault, managedTools, excludedCategories, inertMcpCategories };
}

function asRecord(value: unknown): Record<string, unknown> {
  if (value === null || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(Object.entries(value));
}

/**
 * The `agent` keys the `zed` override may author. Everything else — above all
 * `tool_permissions`, which the canonical `permission` block owns end to end —
 * is refused, so an override can never reach past its own surface and weaken a
 * canonical deny. The override object is read key by key rather than spread, so
 * an unlisted key is inert whether or not it is named here — an allowlist, not a
 * denylist, because `agent` carries blunt instruments of its own (Zed's
 * `always_allow_tool_actions` would disarm every permission rule at once), and a
 * verbatim `agent` merge would hand them to the override.
 *
 * Every key the patch does not consume is reported, so an unsupported or
 * misspelled one surfaces as a warning rather than as config that quietly does
 * nothing. `permission` is exempt: it is the canonical tool-scoped block, and
 * `RulesyncPermissions.forTarget` has already consumed and stripped it.
 */
const ZED_OVERRIDE_AGENT_KEYS = ["sandbox_permissions", "profiles"] as const;
const ZED_CANONICAL_AGENT_KEY = "tool_permissions";
const ZED_OVERRIDE_CONSUMED_KEYS: ReadonlySet<string> = new Set<string>([
  ...ZED_OVERRIDE_AGENT_KEYS,
  "permission",
]);

/**
 * Build the `agent` patch fragment carrying the `zed` override's verbatim
 * blocks. A key the override supplies replaces the existing block wholesale
 * (Zed reads each as one unit — a deep merge would leave half of a rewritten
 * sandbox policy behind); a key it omits is left out of the fragment, so the
 * existing value survives via the caller's spread of `agent`.
 */
function buildZedOverridePatch({
  override,
  logger,
}: {
  override: PermissionsConfig["zed"];
  logger?: { warn: (message: string) => void };
}): Record<string, unknown> {
  if (!isPlainObject(override)) return {};

  if (ZED_CANONICAL_AGENT_KEY in override) {
    logger?.warn(
      `Zed permissions: ignoring the 'zed.${ZED_CANONICAL_AGENT_KEY}' override; \`agent.${ZED_CANONICAL_AGENT_KEY}\` is driven by the canonical permission block.`,
    );
  }

  const unsupportedKeys = Object.keys(override).filter(
    (key) => key !== ZED_CANONICAL_AGENT_KEY && !ZED_OVERRIDE_CONSUMED_KEYS.has(key),
  );
  if (unsupportedKeys.length > 0) {
    logger?.warn(
      `Zed permissions: ignoring the ${unsupportedKeys.map((key) => `'zed.${key}'`).join(", ")} ` +
        `override ${unsupportedKeys.length === 1 ? "key" : "keys"} — the \`zed\` block authors only ` +
        `${ZED_OVERRIDE_AGENT_KEYS.map((key) => `\`${key}\``).join(" and ")}.`,
    );
  }

  const patch: Record<string, unknown> = {};
  for (const key of ZED_OVERRIDE_AGENT_KEYS) {
    const value = override[key];
    if (isPlainObject(value)) {
      patch[key] = value;
    }
  }
  return patch;
}

/**
 * The write-side inverse: lift `agent.sandbox_permissions` / `agent.profiles`
 * back into the `zed` override so a hand-written sandbox policy or profile set
 * round-trips instead of being lost on the next generate. Returns `undefined`
 * when the settings carry neither, so the override key is omitted.
 */
function extractZedOverride(agent: Record<string, unknown>): Record<string, unknown> | undefined {
  const override: Record<string, unknown> = {};
  for (const key of ZED_OVERRIDE_AGENT_KEYS) {
    const value = agent[key];
    if (isPlainObject(value)) {
      override[key] = value;
    }
  }
  return Object.keys(override).length > 0 ? override : undefined;
}

/**
 * Permissions generator for the Zed editor.
 *
 * Zed maps tool permissions onto `agent.tool_permissions` inside its settings
 * file (`.zed/settings.json` for project, `~/.config/zed/settings.json` for
 * global). That file is shared with the MCP (`context_servers`) and ignore
 * (`private_files`) features, so reads and writes merge into the existing JSON
 * rather than overwriting it, and the file is never deleted.
 *
 * Zed's OS sandbox (`agent.sandbox_permissions`) and its tool-availability
 * profiles (`agent.profiles`) are separate enforcement layers with no canonical
 * counterpart; they are authored verbatim through the `zed` override and lifted
 * back out of the settings on import. See `ZedPermissionsOverrideSchema`.
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

    const { managedDefault, managedTools, excludedCategories, inertMcpCategories } =
      buildZedToolPermissions({ permission: honorAllToolsOnBash(config.permission), logger });

    if (excludedCategories.length > 0) {
      logger?.warn(
        `Zed permissions: dropping the ${excludedCategories.map((category) => `"${category}"`).join(", ")} ` +
          `${excludedCategories.length === 1 ? "category" : "categories"} — Zed does not gate its ` +
          `read-only tools, so the entries would never be consulted. Zed's read-denial surface is ` +
          `\`private_files\`, which the ignore feature writes from \`.rulesync/.aiignore\`.`,
      );
    }

    if (inertMcpCategories.length > 0) {
      logger?.warn(
        `Zed permissions: dropping the ${inertMcpCategories.map((category) => `"${category}"`).join(", ")} ` +
          `${inertMcpCategories.length === 1 ? "category" : "categories"} — Zed looks an MCP tool up by ` +
          `exact key on the full \`mcp:<server>:<tool>\` triple, so an address that omits or wildcards ` +
          `either half matches nothing. Name the individual server and tool instead.`,
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
    // Every canonical-spelled `mcp__server__tool` entry on disk is swept,
    // whether or not the current config still names that category. Like
    // `tools["*"]`, it is not a Zed tool name, so it can only be an earlier
    // rulesync version's output — leaving it would strand a dead key that no
    // later generate cleans up, and that import would fold back into the
    // canonical category, resurrecting rules the config no longer states.
    for (const toolName of Object.keys(existingTools)) {
      if (toolName.startsWith(MCP_CANONICAL_PREFIX)) {
        managedToolNames.add(toolName);
      }
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
            ...buildZedOverridePatch({ override: config.zed, logger }),
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

    const agent = asRecord(settings.agent);
    const toolPermissionsRaw = agent.tool_permissions;
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

    const zedOverride = extractZedOverride(agent);
    const result: Record<string, unknown> = { permission };
    if (zedOverride !== undefined) {
      result.zed = zedOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
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
