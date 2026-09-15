import { join } from "node:path";

import {
  CRUSH_ALLOWED_TOOLS_KEY,
  CRUSH_DISABLED_TOOLS_KEY,
  CRUSH_OPTIONS_KEY,
  CRUSH_PERMISSIONS_KEY,
} from "../../constants/crush-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import type { Logger } from "../../utils/logger.js";
import { lookupOwn } from "../../utils/own-lookup.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  crushConfigImportContent,
  getCrushConfigSettablePaths,
  parseCrushConfig,
  resolveCrushConfigFile,
  warnCrushTwinLeftovers,
} from "../crush-config.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { ALL_TOOLS_PERMISSION_CATEGORY, honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

// The catch-all rulesync pattern; a rule about the whole tool.
const CATCH_ALL_PATTERN = "*";

/**
 * A run of `*` (`**`, `***`) is the catch-all spelled another way: Crush has no
 * argument patterns at all, so it is the only pattern a rule can carry and
 * still be written.
 */
function normalizeCatchAllPattern(pattern: string): string {
  return /^\*+$/.test(pattern) ? CATCH_ALL_PATTERN : pattern;
}

// rulesync canonical categories -> Crush's built-in tool names. Any other
// category passes through verbatim, so a further built-in (`ls`, `multiedit`,
// `sourcegraph`, ...) can be named directly.
// https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
const CANONICAL_TO_CRUSH_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read: "view",
  edit: "edit",
  write: "write",
  grep: "grep",
  glob: "glob",
  webfetch: "fetch",
};

const CRUSH_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CRUSH_TOOL_NAMES).map(([k, v]) => [v, k]),
);

// The canonical per-tool MCP category (`mcp__<server>__<tool>`) and the name
// Crush registers an MCP tool under (`mcp_<server>_<tool>`).
const MCP_CANONICAL_PREFIX = "mcp__";
const MCP_CRUSH_PREFIX = "mcp_";

// Own-property lookups only: a `constructor` category would otherwise resolve
// to the `Object` function through the prototype chain.
function toCrushToolName(canonical: string): string {
  if (Object.hasOwn(CANONICAL_TO_CRUSH_TOOL_NAMES, canonical)) {
    return CANONICAL_TO_CRUSH_TOOL_NAMES[canonical] ?? canonical;
  }
  if (
    canonical.startsWith(MCP_CANONICAL_PREFIX) &&
    canonical.length > MCP_CANONICAL_PREFIX.length
  ) {
    // `mcp__server__tool` -> `mcp_server_tool`, the name Crush's permission
    // service sees for that MCP tool.
    return `${MCP_CRUSH_PREFIX}${canonical.slice(MCP_CANONICAL_PREFIX.length).replaceAll("__", "_")}`;
  }
  return canonical;
}

// A Crush tool name maps back to the canonical category of the same built-in;
// anything else (including `mcp_<server>_<tool>`, whose server/tool split is
// ambiguous once the double underscore is gone) is kept verbatim, which
// regenerates unchanged.
function toCanonicalToolName(crushName: string): string {
  return Object.hasOwn(CRUSH_TO_CANONICAL_TOOL_NAMES, crushName)
    ? (CRUSH_TO_CANONICAL_TOOL_NAMES[crushName] ?? crushName)
    : crushName;
}

function isMcpToolName(crushName: string): boolean {
  return crushName.startsWith(MCP_CRUSH_PREFIX) && crushName.length > MCP_CRUSH_PREFIX.length;
}

type CrushToolLists = {
  allowed: string[];
  disabled: string[];
};

function uniq(values: string[]): string[] {
  return [...new Set(values)];
}

/**
 * Permissions adapter for Crush.
 *
 * Crush has no per-argument permission rules. Its JSON config carries two
 * tool-level lists instead:
 *   - `permissions.allowed_tools`: tools (or `tool:action` pairs) that run
 *     without a permission prompt; everything else prompts.
 *   - `options.disabled_tools`: built-in tools removed from the agent
 *     entirely.
 *
 * Mapping (rulesync canonical -> Crush), catch-all (`*`) rules only:
 *   - `allow` -> an `allowed_tools` entry.
 *   - `deny` -> a `disabled_tools` entry. Crush only filters its built-ins
 *     through that list, so a deny for an MCP tool is reported and skipped
 *     (disable the tool in the MCP server's `disabled_tools` instead).
 *   - `ask` -> nothing (prompting is Crush's default).
 *   - Tool name: `bash` -> `bash`, `read` -> `view`, `edit` -> `edit`,
 *     `write` -> `write`, `grep` -> `grep`, `glob` -> `glob`,
 *     `webfetch` -> `fetch`, `mcp__<server>__<tool>` -> `mcp_<server>_<tool>`;
 *     any other category passes through verbatim.
 *
 * A pattern-specific rule cannot be expressed and is reported and skipped.
 * Because Crush cannot narrow an allowed tool, a category's catch-all `allow`
 * is not written while the same category carries a pattern-specific `deny` or
 * `ask`: the tool keeps prompting (fail closed) rather than being widened to
 * everything. The all-tools `*` category is mirrored onto `bash` by
 * `honorAllToolsOnBash` and otherwise skipped, since Crush has no allow-all
 * or disable-all list.
 *
 * `crush.json` is Crush's main config: entries naming a tool the canonical
 * config does not manage, and every `tool:action` entry (a form rulesync
 * never derives), are preserved verbatim; the managed tools' bare entries
 * are rebuilt, every other key of `permissions` / `options` and of the file is
 * kept, and the file is never deleted. Project scope writes `crush.json`, or
 * an existing `.crush.json`; Crush merges the pair (lists concatenated), so an
 * entry left in the other file stays in effect and is reported.
 *
 * @see https://github.com/charmbracelet/crush/blob/main/docs/config/README.md
 * @see https://github.com/charmbracelet/crush/blob/main/internal/config/config.go
 * @see https://github.com/charmbracelet/crush/blob/main/internal/permission/permission.go
 */
export class CrushPermissions extends ToolPermissions {
  private readonly json: Record<string, unknown>;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "",
    });
    this.json = parseCrushConfig(
      this.fileContent ?? "",
      join(this.relativeDirPath, this.relativeFilePath),
    );
  }

  getJson(): Record<string, unknown> {
    return this.json;
  }

  override isDeletable(): boolean {
    return false;
  }

  /**
   * `crush.json` is Crush's file: rulesync merges into it when it exists but
   * does not create one that holds nothing of its own — an absent file and an
   * absent `allowed_tools` both mean "prompt for everything".
   */
  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return getCrushConfigSettablePaths({ global });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CrushPermissions> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    return new CrushPermissions({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      fileContent: crushConfigImportContent(location),
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CrushPermissions> {
    const location = await resolveCrushConfigFile({ outputRoot, global });
    const existingContent = location.fileContent ?? "";
    warnCrushTwinLeftovers({
      location,
      ownedPaths: [
        [CRUSH_PERMISSIONS_KEY, CRUSH_ALLOWED_TOOLS_KEY],
        [CRUSH_OPTIONS_KEY, CRUSH_DISABLED_TOOLS_KEY],
      ],
      logger,
    });
    const existing = parseCrushConfig(existingContent, location.filePath);
    const existingPermissions = isRecord(existing[CRUSH_PERMISSIONS_KEY])
      ? existing[CRUSH_PERMISSIONS_KEY]
      : undefined;
    const existingOptions = isRecord(existing[CRUSH_OPTIONS_KEY])
      ? existing[CRUSH_OPTIONS_KEY]
      : undefined;

    const config = rulesyncPermissions.getJson();
    const generated = convertRulesyncToCrushLists({ config, logger });
    const managedToolNames = managedCrushToolNames(config);

    // Keep the entries rulesync could not have derived — a `tool:action`
    // pair (narrower than any canonical catch-all) or a bare name of an
    // unmanaged tool — and rebuild the managed tools' bare entries.
    const preservedAllowed = (
      isStringArray(existingPermissions?.[CRUSH_ALLOWED_TOOLS_KEY])
        ? existingPermissions[CRUSH_ALLOWED_TOOLS_KEY]
        : []
    ).filter((entry) => entry.includes(":") || !managedToolNames.has(entry));
    const preservedDisabled = (
      isStringArray(existingOptions?.[CRUSH_DISABLED_TOOLS_KEY])
        ? existingOptions[CRUSH_DISABLED_TOOLS_KEY]
        : []
    ).filter((entry) => !managedToolNames.has(entry));

    const allowedList = uniq([...preservedAllowed, ...generated.allowed]);
    const disabledList = uniq([...preservedDisabled, ...generated.disabled]);

    // An empty list retracts its key (`undefined` deletes under deep-merge).
    // A group is only touched when there is something to write into it or it
    // already exists, so a config without tool rules does not grow an empty
    // `permissions: {}` / `options: {}`.
    const patch: Record<string, unknown> = {};
    if (allowedList.length > 0 || existingPermissions !== undefined) {
      patch[CRUSH_PERMISSIONS_KEY] = {
        [CRUSH_ALLOWED_TOOLS_KEY]: allowedList.length > 0 ? allowedList : undefined,
      };
    }
    if (disabledList.length > 0 || existingOptions !== undefined) {
      patch[CRUSH_OPTIONS_KEY] = {
        [CRUSH_DISABLED_TOOLS_KEY]: disabledList.length > 0 ? disabledList : undefined,
      };
    }

    return new CrushPermissions({
      outputRoot,
      relativeDirPath: location.relativeDirPath,
      relativeFilePath: location.relativeFilePath,
      // Keyed by the base settable paths: a resolved `.crush.json` twin shares
      // the `crush.json` ownership declaration.
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(CrushPermissions.getSettablePaths({ global })),
        feature: "permissions",
        existingContent,
        patch,
        filePath: location.filePath,
        logger,
      }),
      validate: true,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permissions = isRecord(this.json[CRUSH_PERMISSIONS_KEY])
      ? this.json[CRUSH_PERMISSIONS_KEY]
      : {};
    const options = isRecord(this.json[CRUSH_OPTIONS_KEY]) ? this.json[CRUSH_OPTIONS_KEY] : {};
    const rulesyncConfig = convertCrushListsToRulesync({
      allowed: isStringArray(permissions[CRUSH_ALLOWED_TOOLS_KEY])
        ? permissions[CRUSH_ALLOWED_TOOLS_KEY]
        : [],
      disabled: isStringArray(options[CRUSH_DISABLED_TOOLS_KEY])
        ? options[CRUSH_DISABLED_TOOLS_KEY]
        : [],
    });

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(rulesyncConfig, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): CrushPermissions {
    // The shared config file is never deleted (isDeletable() === false), but
    // forDeletion must still return a well-formed instance.
    return new CrushPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
      global,
    });
  }
}

/**
 * The Crush tool names the canonical config manages, i.e. the names its
 * categories map to. Entries naming any other tool are the user's and survive
 * a generate. The all-tools `*` category names no Crush tool of its own.
 */
function managedCrushToolNames(config: PermissionsConfig): Set<string> {
  return new Set(
    Object.keys(config.permission)
      .filter(
        (category) =>
          category !== ALL_TOOLS_PERMISSION_CATEGORY && !isPrototypePollutionKey(category),
      )
      .map((category) => toCrushToolName(category)),
  );
}

/**
 * Reduce one category's rules to the single tool-wide action Crush can carry,
 * or undefined when nothing should be written for the tool: no catch-all rule,
 * a catch-all allow next to a narrower deny/ask (Crush cannot narrow an
 * allowed tool, so it keeps prompting instead), or a deny on an MCP tool
 * (`options.disabled_tools` only covers built-ins).
 */
function resolveCategoryAction({
  category,
  toolName,
  rules,
  logger,
}: {
  category: string;
  toolName: string;
  rules: Record<string, PermissionAction>;
  logger?: Logger;
}): PermissionAction | undefined {
  let catchAllAction: PermissionAction | undefined;
  let restricted = false;

  for (const [rawPattern, action] of Object.entries(rules)) {
    if (isPrototypePollutionKey(rawPattern)) continue;
    const pattern = normalizeCatchAllPattern(rawPattern);
    if (pattern === CATCH_ALL_PATTERN) {
      catchAllAction = action;
      continue;
    }
    logger?.warn(
      `Crush permissions are tool-wide (no argument patterns), so the "${action}" rule for ` +
        `"${category}" (pattern ${quoteValueForWarning(pattern)}) was skipped.`,
    );
    if (action !== "allow") {
      restricted = true;
    }
  }

  if (catchAllAction === "allow" && restricted) {
    logger?.warn(
      `Crush cannot narrow an allowed tool, so "${category}" is not added to ` +
        `permissions.allowed_tools while it carries a pattern-specific deny/ask rule; ` +
        `Crush keeps prompting for "${toolName}".`,
    );
    return undefined;
  }
  if (catchAllAction === "deny" && isMcpToolName(toolName)) {
    logger?.warn(
      `Crush's options.disabled_tools only covers built-in tools, so the "deny" rule for ` +
        `"${category}" was skipped; disable the tool through the MCP server's "disabled_tools" instead.`,
    );
    return undefined;
  }
  return catchAllAction;
}

/**
 * Convert a rulesync permissions config into Crush's two tool lists.
 */
function convertRulesyncToCrushLists({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): CrushToolLists {
  const lists: CrushToolLists = { allowed: [], disabled: [] };
  // Two categories can resolve to the same Crush tool (`read` and a
  // pass-through `view`), so a disagreement between them is reported rather
  // than silently resolved.
  const actionByTool = new Map<string, PermissionAction>();

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    if (isPrototypePollutionKey(category)) continue;
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      // `honorAllToolsOnBash` has already mirrored the restrictions onto bash.
      for (const [rawPattern, action] of Object.entries(rules)) {
        if (isPrototypePollutionKey(rawPattern)) continue;
        logger?.warn(
          `Crush has no allow-all or disable-all tool list, so the "${action}" rule for "*" ` +
            `(pattern ${quoteValueForWarning(rawPattern)}) was skipped.`,
        );
      }
      continue;
    }

    const toolName = toCrushToolName(category);
    const catchAllAction = resolveCategoryAction({ category, toolName, rules, logger });
    if (catchAllAction === undefined) {
      continue;
    }

    const previous = actionByTool.get(toolName);
    if (previous !== undefined && previous !== catchAllAction) {
      logger?.warn(
        `Crush permissions: rules from different categories both resolve to ` +
          `${quoteValueForWarning(toolName)} with conflicting actions (${previous} and ${catchAllAction}). ` +
          `Both are written; a disabled tool is hidden from the agent regardless of allowed_tools.`,
      );
    }
    actionByTool.set(toolName, catchAllAction);
    if (catchAllAction === "allow") {
      lists.allowed.push(toolName);
    } else if (catchAllAction === "deny") {
      lists.disabled.push(toolName);
    }
    // `ask` is Crush's default: nothing to write.
  }

  return { allowed: uniq(lists.allowed), disabled: uniq(lists.disabled) };
}

/**
 * Convert Crush's two tool lists back into a rulesync config. A `tool:action`
 * entry scopes an allow to one action of a tool, which the canonical model
 * cannot express, so it is left out rather than widened to the whole tool.
 */
function convertCrushListsToRulesync({ allowed, disabled }: CrushToolLists): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  // Buckets are looked up as own properties only: a `toString` entry must
  // create its own record rather than write into the inherited function.
  const bucketFor = (category: string): Record<string, PermissionAction> => {
    const own = lookupOwn({ record: permission, key: category });
    if (own !== undefined) return own;
    const created: Record<string, PermissionAction> = {};
    permission[category] = created;
    return created;
  };

  for (const entry of disabled) {
    if (entry === "" || isPrototypePollutionKey(entry)) continue;
    bucketFor(toCanonicalToolName(entry))[CATCH_ALL_PATTERN] = "deny";
  }
  for (const entry of allowed) {
    if (entry === "" || entry.includes(":") || isPrototypePollutionKey(entry)) continue;
    // A disabled tool never runs, so its deny wins over a stale allow.
    bucketFor(toCanonicalToolName(entry))[CATCH_ALL_PATTERN] ??= "allow";
  }

  return { permission };
}
