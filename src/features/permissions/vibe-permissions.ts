import { join } from "node:path";

import * as smolToml from "smol-toml";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type {
  PermissionAction,
  PermissionsConfig,
  VibePermissionsOverride,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

type VibeToolConfig = Record<string, unknown> & {
  permission?: string;
  allow?: string[];
  deny?: string[];
  allowlist?: string[];
  denylist?: string[];
  sensitive_patterns?: string[];
};

type VibeConfig = Record<string, unknown> & {
  enabled_tools?: string[];
  disabled_tools?: string[];
  tools?: Record<string, VibeToolConfig>;
};

/**
 * Vibe's builtin tool names are the snake_case of each tool class
 * (`BaseTool.get_name()`): `Edit` → `edit`, `WebFetch` → `web_fetch`,
 * `WebSearch` → `web_search`, alongside `read_file`, `write_file`, `bash` and
 * `grep`. `edit` and `write_file` are distinct tools — `write_file` has been
 * create-only since v2.14.0 — so the canonical `edit` and `write` categories
 * must not collapse onto one name. Vibe's subagent tool is `task`, the same
 * rename OpenCode needed.
 */
const CANONICAL_TO_VIBE_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read: "read_file",
  edit: "edit",
  write: "write_file",
  webfetch: "web_fetch",
  websearch: "web_search",
  grep: "grep",
  agent: "task",
};

const VIBE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = {
  bash: "bash",
  read_file: "read",
  edit: "edit",
  write_file: "write",
  web_fetch: "webfetch",
  web_search: "websearch",
  grep: "grep",
  task: "agent",
};

/**
 * Vibe's managed shell is a different tool — and therefore a different
 * permission table — on each platform. The POSIX one publishes `bash`
 * (`ExperimentalBash.get_name()`), so it already reads `[tools.bash]`, but the
 * Windows ones publish `git_bash` and `powershell`. A canonical `bash` rule
 * written only to `[tools.bash]` is silently inert on Windows, which is the
 * dangerous direction for a deny, so the canonical category is fanned out to
 * all three tables. An alias the author configured explicitly (as its own
 * category, see {@link resolveVibeToolName}) is left to that entry.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/builtins/git_bash.py
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/builtins/windows_shell.py
 */
const VIBE_SHELL_ALIAS_TOOL_NAMES = ["git_bash", "powershell"];

/**
 * Canonical rulesync permission categories that carry a cross-tool meaning (see
 * the "Supported tool categories" list in `docs/reference/file-formats.md`).
 * A category in this set that has no Vibe builtin (`glob`, `notebookedit`) is
 * skipped with a warning rather than emitted, because `[tools.glob]` would look
 * applied while Vibe never reads it. Any *other* name is taken at face value as
 * a Vibe tool name — MCP tools publish as `<server>_<tool>` and Vibe's tool
 * manager resolves `[tools.<name>]` for every registered tool, builtin or not.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/manager.py
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

export class VibePermissions extends ToolPermissions {
  private readonly toml: VibeConfig;

  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? smolToml.stringify({}),
    });
    this.toml = parseVibeConfig(this.fileContent);
  }

  getToml(): VibeConfig {
    return this.toml;
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".vibe",
      relativeFilePath: "config.toml",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<VibePermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});

    return new VibePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    validate = true,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<VibePermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const config = parseVibeConfig(existingContent);

    const permission = rulesyncPermissions.getJson().permission;

    const tools = toVibeToolsRecord(config.tools);
    const enabledTools = new Set(toStringArray(config.enabled_tools));
    const disabledTools = new Set(toStringArray(config.disabled_tools));

    // rulesync is the source of truth for every tool it configures, so drop any
    // stale enabled/disabled filters for those tools before reapplying the
    // current state. Filters for tools rulesync does not configure are kept as-is
    // (e.g. a user-defined `enabled_tools` entry for a Vibe-only tool).
    const siblingCategories = Object.keys(permission);
    const removedEnabledTools: string[] = [];
    for (const category of siblingCategories) {
      for (const vibeToolName of resolveVibeToolNames({ category, siblingCategories }) ?? []) {
        if (enabledTools.delete(vibeToolName)) {
          removedEnabledTools.push(vibeToolName);
        }
        disabledTools.delete(vibeToolName);
      }
    }

    for (const [category, rules] of Object.entries(permission)) {
      const vibeToolNames = resolveVibeToolNames({ category, siblingCategories });
      if (vibeToolNames === undefined) {
        const ruleCount = Object.keys(rules).length;
        if (ruleCount > 0) {
          logger?.warn(
            `Vibe has no builtin tool for the '${category}' category; skipping ${ruleCount} ` +
              `rule(s) instead of emitting an inert [tools.${category}] table.`,
          );
        }
        continue;
      }
      applyCategoryRules({
        vibeToolNames,
        category,
        rules,
        tools,
        enabledTools,
        disabledTools,
        logger,
      });
    }

    const vibeOverride = rulesyncPermissions.getJson().vibe;
    applyVibeSensitivePatterns(tools, vibeOverride, logger);

    // `enabled_tools` is exclusive, so removing an entry changes semantics for
    // every OTHER tool too: an emptied list activates all tools, while a
    // surviving list excludes the tools whose entries were just removed. The
    // removal is intended migration for entries earlier rulesync versions
    // wrote, but for a hand-authored exclusive list it is a silent flip — surface it
    // unless the override takes explicit ownership of the key.
    if (removedEnabledTools.length > 0 && vibeOverride?.enabled_tools === undefined && logger) {
      logger.warn(
        `Removed ${removedEnabledTools.join(", ")} from Vibe's exclusive enabled_tools list ` +
          `(rulesync owns the tools it configures and no longer expresses allows through that ` +
          `key). If the exclusive narrowing was intentional, declare the full list explicitly ` +
          `via vibe.enabled_tools in .rulesync/permissions.jsonc.`,
      );
    }

    return new VibePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          tools,
          enabled_tools: resolveEnabledToolsPatch({ vibeOverride, enabledTools }),
          disabled_tools: disabledTools.size > 0 ? [...disabledTools].toSorted() : undefined,
        },
        filePath,
      }),
      validate,
      global,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permission: PermissionsConfig["permission"] = {};
    const vibeOverridePermission: Record<string, { sensitive_patterns: string[] }> = {};

    // A non-empty `enabled_tools` is an exclusive allowlist ("if set, only
    // these tools will be active"), not a set of allow grants — importing it
    // as `"*": "allow"` misrepresented it. It is lifted verbatim into the
    // `vibe` override below instead, so the narrowing round-trips honestly.
    const enabledToolsList = toStringArray(this.toml.enabled_tools);
    for (const tool of toStringArray(this.toml.disabled_tools)) {
      ensurePermission(permission, toCanonicalToolName(tool))["*"] = "deny";
    }

    for (const [vibeToolName, toolConfig] of Object.entries(toVibeToolsRecord(this.toml.tools))) {
      const category = toCanonicalToolName(vibeToolName);
      const rules = ensurePermission(permission, category);
      const action = fromVibePermission(toolConfig.permission);
      if (action !== undefined) {
        rules["*"] = action;
      }
      for (const pattern of toStringArray(toolConfig.allow ?? toolConfig.allowlist)) {
        rules[pattern] = "allow";
      }
      for (const pattern of toStringArray(toolConfig.deny ?? toolConfig.denylist)) {
        rules[pattern] = "deny";
      }

      // `sensitive_patterns` (escalate-to-ASK-when-ALWAYS) has no canonical
      // action, so it round-trips through the `vibe` override rather than the
      // shared block.
      const sensitivePatterns = toStringArray(toolConfig.sensitive_patterns);
      if (sensitivePatterns.length > 0) {
        vibeOverridePermission[category] = { sensitive_patterns: sensitivePatterns };
      }
    }

    // Drop categories that ended up with no rules (e.g. a Vibe tool that carries
    // only `sensitive_patterns`, which routes into the `vibe` override) so the
    // shared block does not accumulate empty `{}` entries.
    for (const [category, rules] of Object.entries(permission)) {
      if (Object.keys(rules).length === 0) {
        delete permission[category];
      }
    }

    collapseFannedShellAliases({ permission, vibeOverridePermission });

    const vibeOverride: Record<string, unknown> = {};
    if (Object.keys(vibeOverridePermission).length > 0) {
      vibeOverride.permission = vibeOverridePermission;
    }
    if (enabledToolsList.length > 0) {
      vibeOverride.enabled_tools = enabledToolsList;
    }

    const json: PermissionsConfig =
      Object.keys(vibeOverride).length > 0 ? { permission, vibe: vibeOverride } : { permission };

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(json, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseVibeConfig(this.fileContent);
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Vibe permissions TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
    global = false,
  }: ToolPermissionsForDeletionParams): VibePermissions {
    return new VibePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
      global,
    });
  }
}

/**
 * Apply the Vibe-scoped override's per-tool `sensitive_patterns` (patterns that
 * escalate to ASK even when the base permission is ALWAYS). rulesync owns this
 * list for any category the override names: a present list is set, an empty
 * one clears it. Categories not named keep whatever the existing file had.
 */
function applyVibeSensitivePatterns(
  tools: Record<string, VibeToolConfig>,
  vibeOverride: VibePermissionsOverride | undefined,
  logger?: Logger,
): void {
  const overridePermission = vibeOverride?.permission ?? {};
  const siblingCategories = Object.keys(overridePermission);
  for (const [category, toolOverride] of Object.entries(overridePermission)) {
    const vibeToolNames = resolveVibeToolNames({ category, siblingCategories });
    if (vibeToolNames === undefined) {
      logger?.warn(
        `Vibe has no builtin tool for the '${category}' category; skipping its ` +
          `vibe.permission.${category}.sensitive_patterns override.`,
      );
      continue;
    }
    const patterns = toStringArray(toolOverride.sensitive_patterns);
    for (const vibeToolName of vibeToolNames) {
      const nextTool = toVibeToolConfig(tools[vibeToolName]);
      if (patterns.length > 0) {
        nextTool.sensitive_patterns = [...patterns].toSorted();
      } else {
        delete nextTool.sensitive_patterns;
      }
      tools[vibeToolName] = nextTool;
    }
  }
}

/**
 * Translate one canonical category's rules into the tool's `[tools.<name>]`
 * table and the top-level `disabled_tools` filter, mutating `tools` and the
 * filter sets in place.
 */
function applyCategoryRules({
  vibeToolNames,
  category,
  rules,
  tools,
  enabledTools,
  disabledTools,
  logger,
}: {
  vibeToolNames: string[];
  category: string;
  rules: Record<string, PermissionAction>;
  tools: Record<string, VibeToolConfig>;
  enabledTools: Set<string>;
  disabledTools: Set<string>;
  logger?: Logger;
}): void {
  for (const vibeToolName of vibeToolNames) {
    applyCategoryRulesToTool({
      vibeToolName,
      category,
      rules,
      tools,
      enabledTools,
      disabledTools,
      logger,
    });
  }
}

/** Write one canonical category's rules into a single `[tools.<name>]` table. */
function applyCategoryRulesToTool({
  vibeToolName,
  category,
  rules,
  tools,
  enabledTools,
  disabledTools,
  logger,
}: {
  vibeToolName: string;
  category: string;
  rules: Record<string, PermissionAction>;
  tools: Record<string, VibeToolConfig>;
  enabledTools: Set<string>;
  disabledTools: Set<string>;
  logger?: Logger;
}): void {
  const existingTool = toVibeToolConfig(tools[vibeToolName]);
  const nextTool: VibeToolConfig = { ...existingTool };
  const allow = new Set(toStringArray(existingTool.allow ?? existingTool.allowlist));
  const deny = new Set(toStringArray(existingTool.deny ?? existingTool.denylist));

  for (const [pattern, action] of Object.entries(rules)) {
    if (pattern === "*") {
      applyWildcardPermission({ action, toolConfig: nextTool });
      if (action === "deny") {
        disabledTools.add(vibeToolName);
        enabledTools.delete(vibeToolName);
      } else if (action === "allow") {
        // Deliberately NOT added to `enabled_tools`: that key is an exclusive
        // allowlist upstream ("if set, only these tools will be active"), so
        // appending tools here to express an allow silently switched off every
        // other builtin and MCP tool. The `[tools.<name>] permission =
        // "always"` entry written above already expresses the allow completely.
        disabledTools.delete(vibeToolName);
      }
      continue;
    }

    if (action === "ask") {
      logger?.warn(
        `Vibe permissions do not support pattern-level "ask" rules. Skipping ${category}: ${pattern}`,
      );
      continue;
    }

    if (action === "allow") {
      allow.add(pattern);
    } else {
      deny.add(pattern);
    }
  }

  // Vibe's per-tool config honors `allowlist`/`denylist` (BaseToolConfig);
  // the legacy `allow`/`deny` keys are tolerated (extra="allow") but never
  // consulted. Emit the canonical keys and drop any legacy keys carried over
  // from the existing file so a server is never left with both.
  delete nextTool.allow;
  delete nextTool.deny;
  if (allow.size > 0) {
    nextTool.allowlist = [...allow].toSorted();
  }
  if (deny.size > 0) {
    nextTool.denylist = [...deny].toSorted();
  }
  tools[vibeToolName] = nextTool;
}

/**
 * `enabled_tools` is an exclusive allowlist and therefore only ever
 * rulesync-authored explicitly, through `vibe.enabled_tools`. When the
 * override declares it (even empty), rulesync owns the whole list; when it
 * does not, the on-disk list survives minus the entries the caller's cleanup
 * loop removed for rulesync-configured tools (which also migrates away the
 * exclusive entries earlier rulesync versions wrote for allow rules).
 */
function resolveEnabledToolsPatch({
  vibeOverride,
  enabledTools,
}: {
  vibeOverride: VibePermissionsOverride | undefined;
  enabledTools: Set<string>;
}): string[] | undefined {
  if (vibeOverride?.enabled_tools !== undefined) {
    const declared = [...new Set(toStringArray(vibeOverride.enabled_tools))];
    return declared.length > 0 ? declared.toSorted() : undefined;
  }
  return enabledTools.size > 0 ? [...enabledTools].toSorted() : undefined;
}

function parseVibeConfig(fileContent: string): VibeConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

/**
 * The Vibe tool tables a permission category writes to, or `undefined` when the
 * category has nowhere to land.
 *
 * A canonical category with a Vibe builtin maps to that builtin's name
 * (`bash` additionally fanning out to the Windows managed shells, see
 * {@link VIBE_SHELL_ALIAS_TOOL_NAMES}). A canonical category *without* one
 * (`glob`, `notebookedit`) resolves to `undefined`: Vibe has no such tool, so a
 * `deny` authored there would look applied while being silently inert — the
 * dangerous direction. Unlike `agent` → `task` there is no correct name to
 * rename to, so the caller skips it with a warning (the grokcli adapter's
 * pattern).
 *
 * Every other name is taken at face value as a Vibe tool name and written to
 * `[tools.<name>]`. That is how MCP tools are reachable: their published name
 * is `<server>_<tool>`, and Vibe's tool manager looks the table up by tool
 * name without restricting it to builtins.
 */
function resolveVibeToolNames({
  category,
  siblingCategories,
}: {
  category: string;
  siblingCategories: Iterable<string>;
}): string[] | undefined {
  // Vibe's config has per-tool tables only; there is no all-tools table for a
  // bare `"*"` category to land in.
  if (category === "*") {
    return undefined;
  }

  const builtin = CANONICAL_TO_VIBE_TOOL_NAMES[category];
  if (builtin === undefined) {
    return CANONICAL_PERMISSION_CATEGORIES.has(category) ? undefined : [category];
  }

  if (builtin !== "bash") {
    return [builtin];
  }

  // An alias the author addressed directly wins over the fan-out; its own
  // category writes that table.
  const explicit = new Set(siblingCategories);
  return [builtin, ...VIBE_SHELL_ALIAS_TOOL_NAMES.filter((name) => !explicit.has(name))];
}

function toCanonicalToolName(vibeToolName: string): string {
  return VIBE_TO_CANONICAL_TOOL_NAMES[vibeToolName] ?? vibeToolName;
}

function toVibeToolsRecord(value: unknown): Record<string, VibeToolConfig> {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return Object.fromEntries(
    Object.entries(value as Record<string, unknown>).map(([toolName, config]) => [
      toolName,
      toVibeToolConfig(config),
    ]),
  );
}

function toVibeToolConfig(value: unknown): VibeToolConfig {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...(value as Record<string, unknown>) };
}

function toStringArray(value: unknown): string[] {
  return Array.isArray(value)
    ? value.filter((item): item is string => typeof item === "string")
    : [];
}

function applyWildcardPermission({
  action,
  toolConfig,
}: {
  action: PermissionAction;
  toolConfig: VibeToolConfig;
}): void {
  if (action === "allow") {
    toolConfig.permission = "always";
  } else if (action === "ask") {
    toolConfig.permission = "ask";
  } else {
    // Vibe's ToolPermission vocabulary is ALWAYS | NEVER | ASK, and Vibe's own
    // plan-mode profile uses `permission = "never"`. Emitting it keeps the
    // per-tool table meaningful (instead of an empty `[tools.<name>]`) and
    // makes the round-trip symmetric — import already reads "never" as deny.
    toolConfig.permission = "never";
  }
}

function fromVibePermission(value: unknown): PermissionAction | undefined {
  if (value === "always" || value === "allow") {
    return "allow";
  }
  if (value === "ask") {
    return "ask";
  }
  if (value === "deny" || value === "never") {
    return "deny";
  }
  return undefined;
}

function ensurePermission(
  permission: PermissionsConfig["permission"],
  category: string,
): Record<string, PermissionAction> {
  const existing = permission[category];
  if (existing) {
    return existing;
  }
  const created: Record<string, PermissionAction> = {};
  permission[category] = created;
  return created;
}

/**
 * A Windows managed-shell table identical to `bash` is this adapter's own
 * fan-out coming back, not a separate decision the author made, so it is
 * collapsed rather than imported as a standalone category. A table that differs
 * is kept: it is a real per-shell rule, and the next generate re-emits it
 * verbatim because an explicit category wins over the fan-out.
 */
function collapseFannedShellAliases({
  permission,
  vibeOverridePermission,
}: {
  permission: PermissionsConfig["permission"];
  vibeOverridePermission: Record<string, { sensitive_patterns: string[] }>;
}): void {
  for (const aliasCategory of VIBE_SHELL_ALIAS_TOOL_NAMES) {
    const aliasRules = permission[aliasCategory];
    const bashRules = permission.bash;
    if (aliasRules && bashRules && arePermissionRulesEqual(aliasRules, bashRules)) {
      delete permission[aliasCategory];
    }

    const aliasPatterns = vibeOverridePermission[aliasCategory];
    const bashPatterns = vibeOverridePermission.bash;
    if (
      aliasPatterns &&
      bashPatterns &&
      arePatternListsEqual(aliasPatterns.sensitive_patterns, bashPatterns.sensitive_patterns)
    ) {
      delete vibeOverridePermission[aliasCategory];
    }
  }
}

function arePermissionRulesEqual(
  a: Record<string, PermissionAction>,
  b: Record<string, PermissionAction>,
): boolean {
  const aKeys = Object.keys(a).toSorted();
  const bKeys = Object.keys(b).toSorted();
  return (
    aKeys.length === bKeys.length &&
    aKeys.every((key, index) => key === bKeys[index] && a[key] === b[key])
  );
}

function arePatternListsEqual(a: string[], b: string[]): boolean {
  return a.length === b.length && a.every((pattern, index) => pattern === b[index]);
}
