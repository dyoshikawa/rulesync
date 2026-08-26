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
 * all three tables. An alias the author configured explicitly — as its own
 * category (see {@link resolveVibeToolNames}) or as a diverging entry already in
 * the config file (see {@link resolveFanOutShellAliases}) — is left alone.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/builtins/git_bash.py
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/builtins/windows_shell.py
 */
const VIBE_SHELL_ALIAS_TOOL_NAMES = ["git_bash", "powershell"];

/** The canonical category (and Vibe tool name) the aliases above fan out from. */
const VIBE_SHELL_CATEGORY = "bash";

/**
 * The `[tools.<name>]` keys the fan-out writes, and therefore the only ones that
 * decide whether an alias table is a decision made outside the `bash` category.
 * The legacy `allow`/`deny` spellings count because rulesync deletes them.
 */
const VIBE_FAN_OUT_MANAGED_KEYS = [
  "permission",
  "allowlist",
  "denylist",
  "allow",
  "deny",
  "sensitive_patterns",
] as const;

/** Canonical per-tool MCP category prefix: `mcp__<server>__<tool>`. */
const MCP_CANONICAL_PREFIX = "mcp__";

/** Glob metacharacters that make an MCP category impossible to address as one table. */
const MCP_WILDCARD_PATTERN = /[*?[\]]/;

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
    const vibeOverride = rulesyncPermissions.getJson().vibe;

    const tools = toVibeToolsRecord(config.tools);
    const enabledTools = new Set(toStringArray(config.enabled_tools));
    const disabledTools = new Set(toStringArray(config.disabled_tools));

    const resolveNames = createVibeToolNameResolver({ permission, config, logger });

    // rulesync is the source of truth for every tool it configures, so drop any
    // stale enabled/disabled filters for those tools before reapplying the
    // current state. Filters for tools rulesync does not configure are kept as-is
    // (e.g. a user-defined `enabled_tools` entry for a Vibe-only tool).
    const removedEnabledTools: string[] = [];
    for (const category of Object.keys(permission)) {
      for (const vibeToolName of resolveNames(category) ?? []) {
        if (enabledTools.delete(vibeToolName)) {
          removedEnabledTools.push(vibeToolName);
        }
        disabledTools.delete(vibeToolName);
      }
    }

    for (const [category, rules] of Object.entries(permission)) {
      const vibeToolNames = resolveNames(category);
      if (vibeToolNames === undefined) {
        const ruleCount = Object.keys(rules).length;
        if (ruleCount > 0) {
          logger?.warn(
            `Vibe has no tool table for the '${category}' category; skipping ${ruleCount} ` +
              `rule(s) instead of emitting an inert [tools.${category}] table.`,
          );
        }
        continue;
      }
      warnOnLookalikeToolName({ category, vibeToolNames, logger });
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

    applyVibeSensitivePatterns({ tools, vibeOverride, resolveNames, logger });

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
function applyVibeSensitivePatterns({
  tools,
  vibeOverride,
  resolveNames,
  logger,
}: {
  tools: Record<string, VibeToolConfig>;
  vibeOverride: VibePermissionsOverride | undefined;
  resolveNames: (category: string) => string[] | undefined;
  logger?: Logger;
}): void {
  for (const [category, toolOverride] of Object.entries(vibeOverride?.permission ?? {})) {
    const vibeToolNames = resolveNames(category);
    if (vibeToolNames === undefined) {
      logger?.warn(
        `Vibe has no tool table for the '${category}' category; skipping its ` +
          `vibe.permission.${category}.sensitive_patterns override.`,
      );
      continue;
    }
    warnOnLookalikeToolName({ category, vibeToolNames, logger });
    const patterns = toStringArray(toolOverride.sensitive_patterns);
    for (const vibeToolName of vibeToolNames) {
      const nextTool = readVibeToolConfig({ tools, vibeToolName });
      if (patterns.length > 0) {
        nextTool.sensitive_patterns = [...patterns].toSorted();
      } else {
        delete nextTool.sensitive_patterns;
      }
      // An override that only clears patterns has nothing left to say about a
      // tool the file never mentioned; emitting a bare `[tools.<name>]` for it
      // would be noise the fan-out then multiplies across all three shells.
      if (Object.keys(nextTool).length === 0 && !Object.hasOwn(tools, vibeToolName)) {
        continue;
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
  const existingTool = readVibeToolConfig({ tools, vibeToolName });
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

  // A category with no expressible rule (`{}`, or only skipped `ask` patterns)
  // has nothing to say about the tool. Emitting `[tools.<name>]` for it would be
  // noise, and the fan-out would multiply that noise across all three shells.
  if (Object.keys(nextTool).length === 0 && !Object.hasOwn(tools, vibeToolName)) {
    return;
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
 * Build the category → `[tools.<name>]` resolver shared by the shared-permission
 * loop and the Vibe override loop, so both agree on which tables `bash`'s
 * fan-out owns by construction instead of recomputing it and drifting apart.
 *
 * Only the shared block may take a shell alias out of the fan-out. A
 * `vibe.permission.<alias>` entry can carry `sensitive_patterns` and nothing
 * else (see `VibePermissionsOverride`), so letting it claim `powershell` would
 * strip the base `bash` permission from that shell while putting no permission
 * in its place — and the resulting table would then look hand-authored to the
 * next generate, making the loss permanent.
 */
function createVibeToolNameResolver({
  permission,
  config,
  logger,
}: {
  permission: PermissionsConfig["permission"];
  config: VibeConfig;
  logger?: Logger;
}): (category: string) => string[] | undefined {
  // Resolving a non-`bash` category never consults the fan-out, so the empty
  // arguments here are inert — this pass exists only to learn the translated
  // names the other categories occupy.
  const claimedBy = new Map<string, string>();
  for (const category of Object.keys(permission)) {
    if (category === VIBE_SHELL_CATEGORY) {
      continue;
    }
    const names = resolveVibeToolNames({ category, claimedToolNames: new Set(), shellAliases: [] });
    for (const vibeToolName of names ?? []) {
      const owner = claimedBy.get(vibeToolName);
      if (owner !== undefined) {
        logger?.warn(
          `The '${owner}' and '${category}' categories both resolve to [tools.${vibeToolName}]; ` +
            `only the last one applied is kept.`,
        );
        continue;
      }
      claimedBy.set(vibeToolName, category);
    }
  }

  const claimedToolNames = new Set(claimedBy.keys());
  const shellAliases = resolveFanOutShellAliases({ config, logger });
  return (category: string) => resolveVibeToolNames({ category, claimedToolNames, shellAliases });
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
 * A canonical MCP category (`mcp__<server>__<tool>`) is translated to Vibe's own
 * published MCP name, `<server>_<tool>` — see {@link toVibeMcpToolName}. Every
 * other name is taken at face value as a Vibe tool name and written to
 * `[tools.<name>]`, because Vibe's tool manager looks the table up by tool name
 * without restricting it to builtins.
 */
function resolveVibeToolNames({
  category,
  claimedToolNames,
  shellAliases,
}: {
  category: string;
  claimedToolNames: ReadonlySet<string>;
  shellAliases: readonly string[];
}): string[] | undefined {
  // Vibe's config has per-tool tables only, so there is no all-tools table for a
  // bare `"*"` category. `disabled_tools` does match glob patterns (`name_matches`
  // in `vibe/core/utils/matching.py`), but an entry there removes the tool from
  // the registry outright rather than acting as a default the sibling
  // `[tools.<name>]` tables can override, so `disabled_tools = ["*"]` would
  // silently swallow every `allow` authored next to the wildcard.
  // @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/manager.py
  if (category === "*") {
    return undefined;
  }

  if (category.startsWith(MCP_CANONICAL_PREFIX)) {
    return toVibeMcpToolName(category);
  }

  const builtin = Object.hasOwn(CANONICAL_TO_VIBE_TOOL_NAMES, category)
    ? CANONICAL_TO_VIBE_TOOL_NAMES[category]
    : undefined;
  if (builtin === undefined) {
    return CANONICAL_PERMISSION_CATEGORIES.has(category) ? undefined : [category];
  }

  if (builtin !== VIBE_SHELL_CATEGORY) {
    return [builtin];
  }

  // A table another category already owns wins over the fan-out; that category
  // writes it. The claim is checked on the *translated* name, so an MCP category
  // that happens to land on `git_bash` takes the alias too, instead of the
  // winner depending on `Object.entries` order.
  return [builtin, ...shellAliases.filter((name) => !claimedToolNames.has(name))];
}

/**
 * Vibe publishes an MCP tool as `f"{alias}_{remote.name}"`, where the alias is
 * the server's name — so rulesync's canonical `mcp__github__create_issue`
 * addresses `[tools.github_create_issue]`. Writing the canonical spelling
 * verbatim would produce a table Vibe never looks up: an inert deny, the
 * dangerous direction.
 *
 * Only the FIRST separator is split, matching the `zed-permissions.ts` and
 * `cursor-permissions.ts` precedent: upstream concatenates the two names without
 * escaping either, so a tool called `create__issue` is legitimately
 * `github_create__issue`.
 *
 * A server-scoped category (`mcp__github`, no tool part) resolves to
 * `undefined`: Vibe has no server-level permission table, only per-tool ones.
 *
 * The translation is one-way. Vibe's name carries no `mcp` marker and its
 * separator is the same `_` that appears inside server and tool names, so import
 * cannot tell `github_create_issue` from a builtin-shaped name and keeps it
 * as-is. Regenerating from that imported name writes the same table, so the
 * emitted config still round-trips.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/mcp/tools.py
 */
function toVibeMcpToolName(category: string): string[] | undefined {
  const [server, ...toolParts] = category.slice(MCP_CANONICAL_PREFIX.length).split("__");
  const tool = toolParts.join("__");
  if (!server || !tool) {
    return undefined;
  }
  // A wildcard (`mcp__github__*`, `mcp__*__create_issue`) has no single table to
  // land in either: Vibe glob-matches `disabled_tools` entries, but a
  // `[tools.<name>]` lookup is exact, so `[tools."github_*"]` would be an inert
  // deny. Dropped with a warning, as `zed-permissions.ts` drops the same shapes.
  if (MCP_WILDCARD_PATTERN.test(server) || MCP_WILDCARD_PATTERN.test(tool)) {
    return undefined;
  }
  return [`${server}_${tool}`];
}

/**
 * The Windows managed-shell tables `bash`'s fan-out may claim: those the existing
 * config file says nothing about, plus those whose state is identical to
 * `bash`'s and therefore a previous fan-out coming back.
 *
 * An alias the file already configures *differently* is a decision someone made
 * outside this category. Overwriting it would broaden a `permission = "never"`
 * into whatever the canonical `bash` category says, so it is left untouched
 * instead and keeps round-tripping as its own category.
 *
 * Only the keys the fan-out itself writes take part in that comparison.
 * `applyCategoryRules` carries unmanaged keys (a `timeout`, an editor setting)
 * over for `bash` but never copies them to the aliases, so comparing whole
 * tables would make rulesync's OWN output look hand-authored from the second
 * generate onward and freeze the fan-out permanently — a `bash` deny would stop
 * reaching the Windows shells.
 */
function resolveFanOutShellAliases({
  config,
  logger,
}: {
  config: VibeConfig;
  logger?: Logger;
}): string[] {
  const tools = toVibeToolsRecord(config.tools);
  const enabledTools = new Set(toStringArray(config.enabled_tools));
  const disabledTools = new Set(toStringArray(config.disabled_tools));
  const describe = (name: string): string => {
    const table = Object.hasOwn(tools, name) ? (tools[name] ?? {}) : {};
    return JSON.stringify({
      managed: VIBE_FAN_OUT_MANAGED_KEYS.filter((key) => Object.hasOwn(table, key)).map((key) => [
        key,
        table[key as keyof VibeToolConfig],
      ]),
      enabled: enabledTools.has(name),
      disabled: disabledTools.has(name),
    });
  };

  // A table that carries nothing rulesync manages — absent, empty, or holding
  // only unmanaged keys — states no permission decision, so there is none to
  // preserve.
  const noDecision = JSON.stringify({ managed: [], enabled: false, disabled: false });
  const bashState = describe(VIBE_SHELL_CATEGORY);
  const fanOutTargets = VIBE_SHELL_ALIAS_TOOL_NAMES.filter((name) => {
    const state = describe(name);
    return state === noDecision || state === bashState;
  });
  const preserved = VIBE_SHELL_ALIAS_TOOL_NAMES.filter((name) => !fanOutTargets.includes(name));
  if (preserved.length > 0) {
    logger?.warn(
      `Keeping the existing Vibe permission for ${preserved.join(", ")} instead of fanning the ` +
        `'bash' category out to it, because it already differs from [tools.bash] on disk. The ` +
        `'bash' permission does NOT apply to that shell.`,
    );
  }
  return fanOutTargets;
}

/**
 * A non-canonical category is written verbatim as a Vibe tool name, which is how
 * MCP tools stay reachable — but it also means a misspelled builtin becomes an
 * inert table. Case is the one class of typo that can be detected without
 * guessing, so flag it rather than emitting `[tools.Bash]` silently.
 */
function warnOnLookalikeToolName({
  category,
  vibeToolNames,
  logger,
}: {
  category: string;
  vibeToolNames: string[];
  logger?: Logger;
}): void {
  const lowercasedCategory = category.toLowerCase();
  if (lowercasedCategory !== category && lowercasedCategory.startsWith(MCP_CANONICAL_PREFIX)) {
    logger?.warn(
      `The '${category}' category looks like an MCP category, but the canonical prefix is ` +
        `lowercase '${MCP_CANONICAL_PREFIX}'; it is written verbatim to [tools.${category}] ` +
        `instead of being translated to Vibe's MCP tool name.`,
    );
  }
  for (const vibeToolName of vibeToolNames) {
    if (Object.hasOwn(VIBE_TO_CANONICAL_TOOL_NAMES, vibeToolName)) {
      continue;
    }
    const lowercased = vibeToolName.toLowerCase();
    if (lowercased !== vibeToolName && Object.hasOwn(VIBE_TO_CANONICAL_TOOL_NAMES, lowercased)) {
      logger?.warn(
        `The '${category}' category is written to [tools.${vibeToolName}], but Vibe's tool names ` +
          `are lowercase. Did you mean '${VIBE_TO_CANONICAL_TOOL_NAMES[lowercased]}'?`,
      );
    }
  }
}

function toCanonicalToolName(vibeToolName: string): string {
  return Object.hasOwn(VIBE_TO_CANONICAL_TOOL_NAMES, vibeToolName)
    ? (VIBE_TO_CANONICAL_TOOL_NAMES[vibeToolName] ?? vibeToolName)
    : vibeToolName;
}

/**
 * Read one tool's table. Null-prototype based so a `__proto__` tool name is a
 * plain own property here rather than an assignment that silently swaps the
 * record's prototype (and so a lookup for `toString` misses instead of
 * returning a function).
 */
function readVibeToolConfig({
  tools,
  vibeToolName,
}: {
  tools: Record<string, VibeToolConfig>;
  vibeToolName: string;
}): VibeToolConfig {
  return toVibeToolConfig(Object.hasOwn(tools, vibeToolName) ? tools[vibeToolName] : undefined);
}

function toVibeToolsRecord(value: unknown): Record<string, VibeToolConfig> {
  const record: Record<string, VibeToolConfig> = Object.create(null);
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return record;
  }
  for (const [toolName, config] of Object.entries(value as Record<string, unknown>)) {
    record[toolName] = toVibeToolConfig(config);
  }
  return record;
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
  const existing = Object.hasOwn(permission, category) ? permission[category] : undefined;
  if (existing) {
    return existing;
  }
  const created: Record<string, PermissionAction> = {};
  // `defineProperty` rather than assignment so a `[tools.__proto__]` table on
  // disk becomes a real (if useless) own category, instead of reaching the
  // prototype of the imported permission block and mutating it.
  Object.defineProperty(permission, category, {
    value: created,
    writable: true,
    enumerable: true,
    configurable: true,
  });
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
