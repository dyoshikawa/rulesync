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
 * The `[tools.<name>]` keys the `bash` fan-out mirrors onto the alias shells. The
 * legacy `allow`/`deny` spellings are listed because rulesync deletes them from
 * every table a category writes, so the mirror has to clear them too.
 *
 * This is the mirror's copy list only. Whether an alias table states a decision
 * of its own is decided independently, by `resolveFanOutShellAliases`, which
 * compares the legacy and canonical spellings as one list rather than key by key.
 *
 * `sensitive_patterns` is deliberately absent: it is written by the separate
 * `vibe.permission` pass, which addresses each shell by name, so a
 * `vibe.permission.git_bash` entry legitimately leaves that shell holding
 * patterns `[tools.bash]` does not have. Counting it here would read rulesync's
 * own output as an outside decision and freeze the fan-out, and mirroring it
 * would overwrite the per-shell patterns the author asked for.
 */
const VIBE_FAN_OUT_PERMISSION_KEYS = [
  "permission",
  "allowlist",
  "denylist",
  "allow",
  "deny",
] as const;

/** The only key `vibe.permission.<category>` can express. */
const VIBE_OVERRIDE_SUPPORTED_KEY = "sensitive_patterns";

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
    // Read before any pass mutates a table: the fan-out fills a shell's
    // `sensitive_patterns` from `[tools.bash]` but never clears one, so an
    // asymmetry has to be judged against the file as authored.
    const diskShellPatterns = new Map(
      [VIBE_SHELL_CATEGORY, ...VIBE_SHELL_ALIAS_TOOL_NAMES].map((vibeToolName) => [
        vibeToolName,
        toStringArray(readVibeToolConfig({ tools, vibeToolName }).sensitive_patterns),
      ]),
    );
    const enabledTools = new Set(toStringArray(config.enabled_tools));
    const disabledTools = new Set(toStringArray(config.disabled_tools));

    // Only a category that actually writes something may take a shell alias out
    // of `bash`'s fan-out; see `expressesVibePermission`.
    const shellRules = permission[VIBE_SHELL_CATEGORY] ?? {};
    const { claimingCategories, shellAliases, standDownShells } = resolveShellFanOutPlan({
      config,
      permission,
      shellRules,
      vibeOverride,
      logger,
    });
    const resolveNames = createVibeToolNameResolver({
      categories: claimingCategories,
      shellAliases,
      logger,
    });
    // The override pass additionally honors its own per-shell entries: the base
    // fan-out above has already given every shell its permission, so a
    // `vibe.permission.<shell>` entry only needs to keep `bash`'s patterns from
    // overwriting the ones authored for that shell.
    const resolveOverrideNames = createVibeToolNameResolver({
      categories: [...claimingCategories, ...Object.keys(vibeOverride?.permission ?? {})],
      shellAliases,
    });

    // rulesync is the source of truth for every tool it configures, so drop any
    // stale enabled/disabled filters for those tools before reapplying the
    // current state. Filters for tools rulesync does not configure are kept as-is
    // (e.g. a user-defined `enabled_tools` entry for a Vibe-only tool).
    //
    // `disabled_tools` is the exception: that filter IS a base permission, and
    // only a category with a `*` rule states one. Clearing it for a category
    // holding pattern rules alone would silently promote a disabled tool to
    // "enabled, with a denylist" — the dangerous direction. (`enabled_tools`
    // needs no such guard: rulesync no longer writes it at all, so every entry
    // is legacy output being migrated away, and the removal is warned about
    // below.)
    // The two passes resolve the same categories, so a name Vibe cannot reach is
    // reported once rather than once per pass.
    const warnedUnreachable = new Set<string>();
    const warnedLegacyAllow = new Set<string>();
    const removedEnabledTools = clearStaleToolFilters({
      permission,
      resolveNames,
      enabledTools,
      disabledTools,
    });

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
      warnOnUnreachableToolName({ category, vibeToolNames, warned: warnedUnreachable, logger });
      warnOnLegacyAllowPromotion({ vibeToolNames, tools, warned: warnedLegacyAllow, logger });
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

    applyStandDownShellDenies({ shellRules, tools, standDownShells, disabledTools, logger });
    warnOnStrandedShellPatterns({
      diskShellPatterns,
      shellAliases,
      ownedShells: new Set(Object.keys(vibeOverride?.permission ?? {})),
      logger,
    });

    applyVibeSensitivePatterns({
      tools,
      vibeOverride,
      resolveNames: resolveOverrideNames,
      warnedUnreachable,
      logger,
    });

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
          `key); their [tools.<name>] permission carries the rule instead. Note that any entry ` +
          `left in enabled_tools keeps every tool outside it inactive, so an allow authored here ` +
          `stays switched off until the key is empty. If the exclusive narrowing was intentional, ` +
          `declare the full list explicitly via vibe.enabled_tools in .rulesync/permissions.jsonc.`,
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
          // An empty table header is pure noise in a file shared with the MCP
          // feature, and a category that expresses nothing Vibe can read leaves
          // `tools` empty.
          tools: Object.keys(tools).length > 0 ? tools : undefined,
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
    // Two spellings of the same list, because they answer different questions.
    // The canonical names are the categories the filter denies; the raw names are
    // what upstream actually matches a table against. Vibe's `name_matches` is a
    // glob over the RAW tool name, so `disabled_tools = ["read"]` matches nothing
    // — reading it as the `read` category and letting it silence
    // `[tools.read_file]` would disable a tool upstream leaves running.
    const disabledToolNames = new Set(toStringArray(this.toml.disabled_tools));
    for (const tool of disabledToolNames) {
      ensurePermission(permission, toCanonicalToolName(tool))["*"] = "deny";
    }

    for (const [vibeToolName, toolConfig] of Object.entries(toVibeToolsRecord(this.toml.tools))) {
      const category = toCanonicalToolName(vibeToolName);
      // `disabled_tools` is applied last and unconditionally upstream, so a tool
      // listed there is unavailable no matter what its table says. Letting the
      // table win here would import that contradiction as a mere `ask` (or even
      // `always` plus an allowlist) and the next generate would drop the filter
      // entirely — a silent broadening of what the file already forbids. The deny
      // wins instead; drop the contradiction, not the guard. The patterns go with
      // it: they are just as inert upstream, and importing one as an `allow` would
      // carry a hole through a tool the file switched off into every OTHER tool's
      // generated config, where nothing is switched off.
      if (disabledToolNames.has(vibeToolName)) {
        continue;
      }
      const rules = ensurePermission(permission, category);
      const action = fromVibePermission(toolConfig.permission);
      if (action !== undefined) {
        rules["*"] = action;
      }
      for (const pattern of readVibeToolPatterns({ toolConfig, kind: "allow" })) {
        rules[pattern] = "allow";
      }
      for (const pattern of readVibeToolPatterns({ toolConfig, kind: "deny" })) {
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
 * Drop the stale `enabled_tools` / `disabled_tools` entries of every tool
 * rulesync is about to configure, so the current state is reapplied cleanly.
 * Returns the `enabled_tools` entries that were removed, which the caller warns
 * about because that key is an exclusive allowlist.
 */
function clearStaleToolFilters({
  permission,
  resolveNames,
  enabledTools,
  disabledTools,
}: {
  permission: PermissionsConfig["permission"];
  resolveNames: (category: string) => string[] | undefined;
  enabledTools: Set<string>;
  disabledTools: Set<string>;
}): string[] {
  const removedEnabledTools: string[] = [];
  for (const [category, rules] of Object.entries(permission)) {
    const statesBasePermission = Object.hasOwn(rules, "*");
    for (const vibeToolName of resolveNames(category) ?? []) {
      if (enabledTools.delete(vibeToolName)) {
        removedEnabledTools.push(vibeToolName);
      }
      if (statesBasePermission) {
        disabledTools.delete(vibeToolName);
      }
    }
  }
  return removedEnabledTools;
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
  warnedUnreachable,
  logger,
}: {
  tools: Record<string, VibeToolConfig>;
  vibeOverride: VibePermissionsOverride | undefined;
  resolveNames: (category: string) => string[] | undefined;
  warnedUnreachable: Set<string>;
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
    warnOnUnreachableToolName({ category, vibeToolNames, warned: warnedUnreachable, logger });
    // The override block carries `sensitive_patterns` only. Anything else in it
    // is a restriction the author wrote and rulesync silently discards — say so,
    // because the base permission from the shared block can be its exact
    // opposite.
    const unsupportedKeys = Object.keys(toolOverride).filter(
      (key) => key !== VIBE_OVERRIDE_SUPPORTED_KEY,
    );
    if (unsupportedKeys.length > 0) {
      logger?.warn(
        `vibe.permission.${category} carries ${unsupportedKeys.join(", ")}, but the Vibe override ` +
          `only expresses '${VIBE_OVERRIDE_SUPPORTED_KEY}'; author the base permission and the ` +
          `allow/deny patterns in the shared 'permission' block instead. Ignoring those keys.`,
      );
    }
    const patterns = toStringArray(toolOverride.sensitive_patterns);
    // Anything past the first name is a `bash` fan-out alias. `sensitive_patterns`
    // is outside the state `resolveFanOutShellAliases` compares, so an alias can
    // still hold escalation patterns of its own here — and those are the author's
    // only defense once the base permission becomes ALWAYS. Keep them, and merge
    // the override's patterns in alongside rather than replacing either side.
    const [primaryToolName, ...aliasToolNames] = vibeToolNames;
    const primaryPatterns =
      primaryToolName === undefined
        ? []
        : toStringArray(
            readVibeToolConfig({ tools, vibeToolName: primaryToolName }).sensitive_patterns,
          );
    const divergingAliases = aliasToolNames.filter((aliasToolName) => {
      const existing = toStringArray(
        readVibeToolConfig({ tools, vibeToolName: aliasToolName }).sensitive_patterns,
      );
      // An empty list states no decision — it is the absent key spelled out, and
      // Vibe's own `BaseToolConfig` dumps the key that way — so it must not count
      // as patterns of the shell's own, the same rule `describe` applies to
      // `allowlist`/`denylist`.
      return existing.length > 0 && !arePatternListsEqual(existing, primaryPatterns);
    });
    if (divergingAliases.length > 0) {
      // An empty override list clears the patterns everywhere else, but a
      // diverging alias keeps its own — there is nothing to merge into it, so say
      // that instead of announcing a merge that does not happen.
      logger?.warn(
        patterns.length === 0
          ? `Keeping the existing Vibe sensitive_patterns of ${divergingAliases.join(", ")} ` +
              `even though vibe.permission.${category}.sensitive_patterns is empty, because an ` +
              `empty list clears only the patterns this override owns and that shell authored ` +
              `its own. Delete them from config.toml to clear them.`
          : `Merging vibe.permission.${category}.sensitive_patterns into the existing Vibe ` +
              `sensitive_patterns of ${divergingAliases.join(", ")} rather than replacing them, ` +
              `because the existing config.toml already sets different patterns for that shell. ` +
              `Author vibe.permission.${divergingAliases.join(", ")}.sensitive_patterns to own ` +
              `its list outright.`,
      );
    }

    for (const vibeToolName of vibeToolNames) {
      const nextTool = readVibeToolConfig({ tools, vibeToolName });
      // A diverging alias keeps its own patterns and gains the override's: a
      // `sensitive_patterns` hit only escalates to ASK (`_is_sensitive` in
      // `vibe/core/tools/builtins/bash.py` forces `_is_unconditionally_allowed`
      // false), so the union can restrict that shell but never broaden it.
      const merged = divergingAliases.includes(vibeToolName)
        ? [...new Set([...toStringArray(nextTool.sensitive_patterns), ...patterns])]
        : patterns;
      if (merged.length > 0) {
        nextTool.sensitive_patterns = merged.toSorted();
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
  const [primaryToolName, ...aliasToolNames] = vibeToolNames;
  if (primaryToolName === undefined) {
    return;
  }

  applyCategoryRulesToTool({
    vibeToolName: primaryToolName,
    category,
    rules,
    tools,
    enabledTools,
    disabledTools,
    logger,
  });

  // A category that expresses nothing Vibe can read (only pattern-level `ask`,
  // or no rules at all) states no permission, so it must not push `[tools.bash]`'s
  // existing one onto shells the file never configured — that would broaden them
  // to whatever `bash` happens to allow, silently and in the dangerous direction.
  if (!expressesVibePermission(rules)) {
    return;
  }

  // The fan-out must leave every shell holding the SAME permission state as the
  // primary table, so mirror it rather than merging each alias with its own
  // previous contents. Merging diverges the very first time `[tools.bash]`
  // carries an entry the aliases lack — which rulesync's own output does as soon
  // as a hand-authored `denylist` is merged into `bash` — and that divergence
  // then stands the fan-out down forever, silently stranding every later `bash`
  // deny on POSIX only. Mirroring is safe precisely because
  // `resolveFanOutShellAliases` has already excluded any alias that states a
  // decision of its own: what is left either matches `bash` or says nothing.
  for (const aliasToolName of aliasToolNames) {
    mirrorFanOutState({ tools, primaryToolName, aliasToolName, disabledTools });
  }
}

/** Copy the primary tool's permission state onto one fan-out alias. */
function mirrorFanOutState({
  tools,
  primaryToolName,
  aliasToolName,
  disabledTools,
}: {
  tools: Record<string, VibeToolConfig>;
  primaryToolName: string;
  aliasToolName: string;
  disabledTools: Set<string>;
}): void {
  const primaryTool: Record<string, unknown> = readVibeToolConfig({
    tools,
    vibeToolName: primaryToolName,
  });
  const nextTool: Record<string, unknown> = readVibeToolConfig({
    tools,
    vibeToolName: aliasToolName,
  });
  for (const key of VIBE_FAN_OUT_PERMISSION_KEYS) {
    const value = primaryTool[key];
    if (value === undefined) {
      delete nextTool[key];
    } else {
      nextTool[key] = Array.isArray(value) ? [...value] : value;
    }
  }

  // `sensitive_patterns` is outside the mirrored state, because the
  // `vibe.permission` pass owns it and addresses each shell by name. But an
  // alias that has none of its own would otherwise receive `[tools.bash]`'s
  // permission while its ASK escalation stayed behind — spreading an allow and
  // dropping the guard that came with it. Fill it in; never overwrite.
  const primaryPatterns = primaryTool.sensitive_patterns;
  if (nextTool.sensitive_patterns === undefined && Array.isArray(primaryPatterns)) {
    // Sorted like every list rulesync emits, so an unsorted hand-authored guard
    // does not produce one throwaway diff on the next generate. A non-array value
    // is left behind rather than replicated onto two more tables.
    nextTool.sensitive_patterns = [...primaryPatterns].toSorted();
  }

  // `disabled_tools` membership is part of that shared state and is mirrored even
  // when the category itself did not state a base permission: the three shells are
  // one decision, and leaving the alias out would re-diverge them and stand the
  // fan-out down on the next generate. (`enabled_tools` needs no handling here —
  // `clearStaleToolFilters` already removed every name this category resolves to,
  // and warned about it.)
  if (disabledTools.has(primaryToolName)) {
    disabledTools.add(aliasToolName);
  } else {
    disabledTools.delete(aliasToolName);
  }

  // Unmanaged keys the alias already had (a `timeout`, an editor setting) are
  // kept; a table left with nothing at all is not created.
  if (Object.keys(nextTool).length === 0 && !Object.hasOwn(tools, aliasToolName)) {
    return;
  }
  tools[aliasToolName] = nextTool;
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
  const allow = new Set(readVibeToolPatterns({ toolConfig: existingTool, kind: "allow" }));
  const deny = new Set(readVibeToolPatterns({ toolConfig: existingTool, kind: "deny" }));

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
  // An empty list states nothing, so it is dropped rather than carried over from
  // the existing file — otherwise the fan-out mirrors the empty key onto every
  // shell as pure noise.
  if (allow.size > 0) {
    nextTool.allowlist = [...allow].toSorted();
  } else {
    delete nextTool.allowlist;
  }
  if (deny.size > 0) {
    nextTool.denylist = [...deny].toSorted();
  } else {
    delete nextTool.denylist;
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
 * `categories` is the set allowed to claim a table. For the shared-permission
 * pass it holds only the categories that actually write one, so a
 * `vibe.permission.<alias>` entry — which can carry `sensitive_patterns` and
 * nothing else (see `VibePermissionsOverride`) — never strips the base `bash`
 * permission from a shell. For the override pass those entries ARE included,
 * because by then every shell already has its permission and the only thing
 * left to protect is the shell's own patterns.
 */
function createVibeToolNameResolver({
  categories,
  shellAliases,
  logger,
}: {
  categories: readonly string[];
  shellAliases: readonly string[];
  logger?: Logger;
}): (category: string) => string[] | undefined {
  // Resolving a non-`bash` category never consults the fan-out, so the empty
  // arguments here are inert — this pass exists only to learn the translated
  // names the other categories occupy.
  const claimedBy = new Map<string, string>();
  for (const category of categories) {
    if (category === VIBE_SHELL_CATEGORY) {
      continue;
    }
    const names = resolveVibeToolNames({ category, claimedToolNames: new Set(), shellAliases: [] });
    for (const vibeToolName of names ?? []) {
      const owner = claimedBy.get(vibeToolName);
      if (owner !== undefined) {
        logger?.warn(
          `The '${owner}' and '${category}' categories both resolve to [tools.${vibeToolName}]; ` +
            `their allow/deny patterns are merged, and the last base permission applied wins.`,
        );
        continue;
      }
      claimedBy.set(vibeToolName, category);
      if (
        VIBE_SHELL_ALIAS_TOOL_NAMES.includes(vibeToolName) &&
        categories.includes(VIBE_SHELL_CATEGORY)
      ) {
        logger?.warn(
          `The '${category}' category writes [tools.${vibeToolName}], which is one of Vibe's ` +
            `Windows managed shells, so the 'bash' category is no longer fanned out to it.`,
        );
      }
    }
  }

  const claimedToolNames = new Set(claimedBy.keys());
  return (category: string) => resolveVibeToolNames({ category, claimedToolNames, shellAliases });
}

/**
 * Whether a category's rules produce anything Vibe can read, and therefore
 * whether the category may claim a `[tools.<name>]` table out of `bash`'s
 * fan-out. A category holding only pattern-level `ask` rules (which Vibe cannot
 * express) or no rules at all writes no table — letting it claim `powershell`
 * would drop the `bash` deny for that shell and put nothing in its place, which
 * is the dangerous direction.
 */
/** What the `bash` category has to spread across the managed shells. */
type VibeShellFanOutKind = "permission" | "patterns" | "none";

/**
 * A `vibe.permission.bash` entry alone spreads `sensitive_patterns` and nothing
 * else, so it must not be reported as a `bash` *permission* that does or does
 * not reach a shell.
 */
function resolveShellFanOutKind({
  shellRules,
  vibeOverride,
}: {
  shellRules: Record<string, PermissionAction>;
  vibeOverride: VibePermissionsOverride | undefined;
}): VibeShellFanOutKind {
  if (expressesVibePermission(shellRules)) {
    return "permission";
  }
  return Object.hasOwn(vibeOverride?.permission ?? {}, VIBE_SHELL_CATEGORY) ? "patterns" : "none";
}

function expressesVibePermission(rules: Record<string, PermissionAction>): boolean {
  return Object.entries(rules).some(([pattern, action]) => pattern === "*" || action !== "ask");
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
  fanOut,
  tightening,
  claimedShells,
  logger,
}: {
  config: VibeConfig;
  /** What the `bash` category has to spread: a permission, only `sensitive_patterns`, or nothing. */
  fanOut: VibeShellFanOutKind;
  /** Whether that permission denies every pattern, and so can only restrict. */
  tightening: boolean;
  /** Shells another category writes by name; neither claimed nor reported here. */
  claimedShells: ReadonlySet<string>;
  logger?: Logger;
}): { aliases: string[]; standDown: string[] } {
  const tools = toVibeToolsRecord(config.tools);
  const disabledTools = new Set(toStringArray(config.disabled_tools));
  // A table states a decision through its base permission and its allow/deny
  // patterns, plus `disabled_tools` membership. `enabled_tools` membership is
  // deliberately NOT part of it: that key is an exclusive registry filter, not a
  // per-tool permission, and counting it let `enabled_tools = ["powershell"]`
  // take that shell out of a `bash` deny AND leave it the only active tool.
  const stateOf = (name: string) => {
    const table = Object.hasOwn(tools, name) ? (tools[name] ?? {}) : {};
    // Compare the same union rulesync writes back (see `readVibeToolPatterns`),
    // so `[tools.bash] allow` next to `[tools.git_bash] allowlist` is the same
    // decision rather than a divergence. Authoring order is not part of it
    // either — upstream matches with `any()` and first-hit — and an empty list
    // states nothing at all, being the absent key spelled out.
    const patterns = (["allow", "deny"] as const).flatMap((kind) => {
      const value = readVibeToolPatterns({ toolConfig: table, kind }).toSorted();
      return value.length > 0 ? [[kind, value] as const] : [];
    });
    // A key whose value is not a list reads as no patterns above, yet the author
    // plainly meant it as a decision. Vibe's own `BaseToolConfig` types these as
    // `list[str]`, so the file fails to load upstream either way and nothing it
    // asks for is in force — but of the two ways to be wrong about it, deleting
    // the key is the one the author cannot recover from. Treat it as a decision
    // and stand the fan-out down.
    const malformed = (["allow", "allowlist", "deny", "denylist"] as const).flatMap((key) =>
      table[key] !== undefined && !Array.isArray(table[key]) ? [[key, table[key]] as const] : [],
    );
    return {
      managed: [
        ...(table.permission === undefined ? [] : [["permission", table.permission] as const]),
        ...patterns,
        ...(malformed.length > 0 ? [["malformed", malformed] as const] : []),
      ],
      disabled: disabledTools.has(name),
    };
  };
  // A table holding none of those — absent, empty, or carrying only keys this
  // comparison leaves out (an editor setting, or the `sensitive_patterns` the
  // `vibe.permission` pass owns and addresses per shell) — has no decision to
  // preserve.
  const statesDecision = (name: string): boolean => {
    const state = stateOf(name);
    return state.managed.length > 0 || state.disabled;
  };
  const describe = (name: string): string => JSON.stringify(stateOf(name));
  const bashState = describe(VIBE_SHELL_CATEGORY);
  // A shell its own category writes is neither a fan-out target nor something
  // this fan-out kept: reporting it would announce a stand-down that never
  // happened, and claim `bash`'s permission does not reach a shell whose own
  // category is about to give it one.
  const candidates = VIBE_SHELL_ALIAS_TOOL_NAMES.filter((name) => !claimedShells.has(name));
  const fanOutTargets = candidates.filter(
    (name) => !statesDecision(name) || describe(name) === bashState,
  );
  // Warn only about what is actually being kept from the shell. Announcing that
  // "the 'bash' permission does NOT apply" while the shared block has no `bash`
  // category points at a permission the file never authored.
  const preserved = candidates.filter((name) => !fanOutTargets.includes(name));
  if (preserved.length === 0 || fanOut === "none") {
    return { aliases: fanOutTargets, standDown: preserved };
  }

  if (fanOut === "patterns") {
    logger?.warn(
      `vibe.permission.bash.sensitive_patterns is not fanned out to ${preserved.join(", ")}, ` +
        `because the existing config.toml already configures that shell differently from 'bash'. ` +
        `Author vibe.permission.${preserved.join(", ")}.sensitive_patterns to set its patterns.`,
    );
    return { aliases: fanOutTargets, standDown: preserved };
  }

  // Standing down protects a decision made outside the category from being
  // *broadened* — a `permission = "never"` overwritten by whatever `bash` says.
  // A `bash` category that denies every pattern cannot broaden anything: the
  // shell ends up disabled outright, which is at least as strict as whatever it
  // held. Letting the stand-down win there would leave a deny the author wrote
  // silently absent from one of the three shells, which is the exact failure
  // this fan-out exists to prevent, so tightening always reaches every shell.
  if (tightening) {
    logger?.warn(
      `Overwriting the existing Vibe permission for ${preserved.join(", ")} with the 'bash' ` +
        `category, because that category denies every pattern and a deny must reach every ` +
        `managed shell. Its own allowlist/denylist entries are replaced too, since the shell ` +
        `ends up disabled outright. Author ${preserved.join(", ")} as its own category to keep ` +
        `a different permission for it.`,
    );
    return { aliases: candidates, standDown: [] };
  }

  // A shell whose only decision is its `disabled_tools` membership has no table
  // at all, so nothing is merged into it — saying otherwise would promise a deny
  // that was never written (it is off the registry, so none is needed).
  const offRegistry = preserved.filter(
    (name) => !Object.hasOwn(tools, name) && disabledTools.has(name),
  );
  const merged = preserved.filter((name) => !offRegistry.includes(name));
  if (merged.length > 0) {
    logger?.warn(
      `Keeping the existing Vibe permission for ${merged.join(", ")} instead of fanning the ` +
        `'bash' category out to it, because the existing config.toml already configures that ` +
        `shell differently from 'bash'. Only the 'bash' deny patterns are merged into it; its ` +
        `base permission and allow patterns are NOT changed.`,
    );
  }
  if (offRegistry.length > 0) {
    logger?.warn(
      `Not fanning the 'bash' category out to ${offRegistry.join(", ")}, because the existing ` +
        `config.toml disables that shell through 'disabled_tools' and gives it no table of its ` +
        `own. Nothing is written for it — an entry there would be inert, since the shell is off ` +
        `Vibe's registry entirely.`,
    );
  }
  return { aliases: fanOutTargets, standDown: preserved };
}

/**
 * Merge the `bash` category's `deny` patterns into the shells the fan-out stood
 * down from.
 *
 * A stand-down keeps a decision made outside the category from being *broadened*,
 * so the shell keeps its own base permission and allow patterns. Its `denylist`
 * is a different matter: Vibe resolves a denylist match before the allowlist and
 * before the configured permission (`_find_denylist_match` in
 * `vibe/core/tools/builtins/bash.py`, `resolve_path_permission` in
 * `vibe/core/tools/utils.py`), so adding entries can only ever restrict that
 * shell. Leaving them out is exactly what a stand-down must not cost: a `deny`
 * the author wrote, silently absent from one of the three managed shells.
 * @see https://github.com/mistralai/mistral-vibe/blob/main/vibe/core/tools/builtins/bash.py
 */
function applyStandDownShellDenies({
  shellRules,
  tools,
  standDownShells,
  disabledTools,
  logger,
}: {
  shellRules: Record<string, PermissionAction>;
  tools: Record<string, VibeToolConfig>;
  standDownShells: readonly string[];
  disabledTools: ReadonlySet<string>;
  logger?: Logger;
}): void {
  const denyPatterns = Object.entries(shellRules)
    .filter(([pattern, action]) => pattern !== "*" && action === "deny")
    .map(([pattern]) => pattern);
  if (denyPatterns.length === 0) {
    return;
  }

  for (const vibeToolName of standDownShells) {
    // A shell that only exists as a `disabled_tools` entry is off the registry
    // entirely, so a denylist for it would be inert. Writing one would invent a
    // table the user never authored and, on the next import, materialize it as a
    // category of its own.
    if (!Object.hasOwn(tools, vibeToolName) && disabledTools.has(vibeToolName)) {
      continue;
    }
    const nextTool = readVibeToolConfig({ tools, vibeToolName });
    // A deny key that is not a list reads as no patterns, so the merge below
    // would silently replace it rather than add to it — the one direction the
    // author cannot recover from, and the same reason `resolveFanOutShellAliases`
    // counts such a key as a decision. Leave the table alone and say so.
    const malformed = (["deny", "denylist"] as const).filter(
      (key) => nextTool[key] !== undefined && !Array.isArray(nextTool[key]),
    );
    if (malformed.length > 0) {
      logger?.warn(
        `Not merging the 'bash' deny patterns into [tools.${vibeToolName}], because its ` +
          `${malformed.join(" and ")} is not a list and merging would replace it. Vibe reads ` +
          `these as arrays, so spell it as one to have the deny reach this shell.`,
      );
      continue;
    }
    // The legacy `deny` spelling is tolerated upstream but never consulted, so
    // fold it into the canonical key instead of leaving the shell with two lists.
    const deny = new Set([
      ...readVibeToolPatterns({ toolConfig: nextTool, kind: "deny" }),
      ...denyPatterns,
    ]);
    delete nextTool.deny;
    nextTool.denylist = [...deny].toSorted();
    tools[vibeToolName] = nextTool;
  }
}

/**
 * Decide how the `bash` category spreads across Vibe's three managed-shell
 * tables: which categories may claim a table of their own, which shells the
 * fan-out writes, and which it stands down from.
 */
function resolveShellFanOutPlan({
  config,
  permission,
  shellRules,
  vibeOverride,
  logger,
}: {
  config: VibeConfig;
  permission: PermissionsConfig["permission"];
  shellRules: Record<string, PermissionAction>;
  vibeOverride: VibePermissionsOverride | undefined;
  logger?: Logger;
}): { claimingCategories: string[]; shellAliases: string[]; standDownShells: string[] } {
  const claimingCategories = Object.keys(permission).filter((category) =>
    expressesVibePermission(permission[category] ?? {}),
  );
  const fanOut = resolveShellFanOutKind({ shellRules, vibeOverride });
  // A shell another category writes by name belongs to that category, so the
  // fan-out neither claims it nor reports it as one it stood down from. In
  // `patterns` mode the shared block states no `bash` permission at all, so the
  // `vibe.permission.<shell>` entries are the only claims that exist.
  const claimedShells = new Set(
    resolveClaimedShellNames(
      fanOut === "patterns"
        ? [...claimingCategories, ...Object.keys(vibeOverride?.permission ?? {})]
        : claimingCategories,
    ),
  );
  const { aliases, standDown } = resolveFanOutShellAliases({
    config,
    fanOut,
    tightening: shellRules["*"] === "deny",
    claimedShells,
    logger,
  });
  return { claimingCategories, shellAliases: aliases, standDownShells: standDown };
}

/**
 * Warn about a managed shell holding `sensitive_patterns` that `[tools.bash]`
 * does not have.
 *
 * The fan-out fills a shell's patterns from `[tools.bash]` but never clears
 * them, and the stand-down comparison deliberately leaves the key out, so
 * deleting the `[tools.bash]` guard strands the copies on the Windows shells
 * with nothing reporting it. Import then reads those copies as per-shell rules
 * and writes `vibe.permission.<shell>.sensitive_patterns` entries the author
 * never wrote — which claim the shell for good, so a later `vibe.permission.bash`
 * guard never reaches it again. The patterns themselves only escalate to ASK, so
 * the state is the safe direction; it is the silence that is not.
 */
function warnOnStrandedShellPatterns({
  diskShellPatterns,
  shellAliases,
  ownedShells,
  logger,
}: {
  diskShellPatterns: ReadonlyMap<string, string[]>;
  shellAliases: readonly string[];
  /** Shells whose patterns `vibe.permission.<shell>` already owns explicitly. */
  ownedShells: ReadonlySet<string>;
  logger?: Logger;
}): void {
  if ((diskShellPatterns.get(VIBE_SHELL_CATEGORY) ?? []).length > 0) {
    return;
  }
  const stranded = shellAliases.filter(
    (name) => !ownedShells.has(name) && (diskShellPatterns.get(name) ?? []).length > 0,
  );
  if (stranded.length === 0) {
    return;
  }
  logger?.warn(
    `${stranded.join(", ")} carries sensitive_patterns that [tools.${VIBE_SHELL_CATEGORY}] does ` +
      `not, and the 'bash' fan-out fills a shell's patterns but never clears them. If they are ` +
      `left over from an earlier vibe.permission.bash guard, delete them; otherwise author ` +
      `vibe.permission.${stranded.join(", ")}.sensitive_patterns, so importing this file does ` +
      `not invent that entry for you and claim the shell out of the fan-out for good.`,
  );
}

/**
 * The Windows managed-shell tables the given categories write by name. Resolved
 * the same way {@link createVibeToolNameResolver} resolves a claim, so the
 * fan-out and the resolver cannot disagree about which shells are already
 * owned — including an MCP category that happens to translate to `git_bash`.
 */
function resolveClaimedShellNames(categories: readonly string[]): string[] {
  return categories
    .filter((category) => category !== VIBE_SHELL_CATEGORY)
    .flatMap(
      (category) =>
        resolveVibeToolNames({ category, claimedToolNames: new Set(), shellAliases: [] }) ?? [],
    )
    .filter((name) => VIBE_SHELL_ALIAS_TOOL_NAMES.includes(name));
}

/**
 * A non-canonical category is written verbatim as a Vibe tool name, which is how
 * MCP tools stay reachable — but it also means a misspelled builtin, a
 * mis-cased MCP prefix, or a glob becomes a table Vibe never looks up. None of
 * those can be corrected without guessing, so flag them rather than emitting an
 * inert `[tools.Bash]` silently.
 */
function warnOnUnreachableToolName({
  category,
  vibeToolNames,
  warned,
  logger,
}: {
  category: string;
  vibeToolNames: string[];
  /** Categories already reported, so the shared and override passes say it once. */
  warned: Set<string>;
  logger?: Logger;
}): void {
  if (warned.has(category)) {
    return;
  }
  warned.add(category);
  // Only the prefix decides whether translation kicks in — a server or tool name
  // may legitimately be capitalized, and those ARE translated.
  const prefix = category.slice(0, MCP_CANONICAL_PREFIX.length);
  if (prefix !== MCP_CANONICAL_PREFIX && prefix.toLowerCase() === MCP_CANONICAL_PREFIX) {
    logger?.warn(
      `The '${category}' category looks like an MCP category, but the canonical prefix is ` +
        `lowercase '${MCP_CANONICAL_PREFIX}'; it is written verbatim to [tools.${category}] ` +
        `instead of being translated to Vibe's MCP tool name.`,
    );
  }
  for (const vibeToolName of vibeToolNames) {
    // `[tools.<name>]` is looked up by exact tool name, so a glob in the name
    // only ever reaches Vibe through the separately glob-matched
    // `disabled_tools` filter that a wildcard `deny` also writes.
    if (MCP_WILDCARD_PATTERN.test(vibeToolName)) {
      logger?.warn(
        `The '${category}' category contains a glob metacharacter, but Vibe looks ` +
          `[tools.${vibeToolName}] up by exact tool name. Only a wildcard '*' deny reaches Vibe ` +
          `here, through the 'disabled_tools' filter; its pattern-level rules are inert.`,
      );
      continue;
    }
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
/**
 * A tool table's allow (or deny) patterns, read as one list.
 *
 * Vibe's permission engine reads `allowlist` / `denylist` (`BaseToolConfig`);
 * the legacy `allow` / `deny` spellings are tolerated by the config model but
 * never consulted. A table carrying BOTH therefore holds one list Vibe enforces
 * and one it ignores, and preferring either alone drops the other — for the deny
 * side that silently discards a restriction Vibe was actually applying. Reading
 * them together means the canonical key rulesync writes back enforces every
 * pattern the file mentioned.
 *
 * The two sides are not symmetric. Reading both deny lists can only restrict
 * further, but reading both allow lists promotes a pattern Vibe was ignoring
 * into one it enforces, so `warnOnLegacyAllowPromotion` announces that before it
 * happens.
 */
function readVibeToolPatterns({
  toolConfig,
  kind,
}: {
  toolConfig: VibeToolConfig;
  kind: "allow" | "deny";
}): string[] {
  const [legacy, canonical] =
    kind === "allow"
      ? [toolConfig.allow, toolConfig.allowlist]
      : [toolConfig.deny, toolConfig.denylist];
  return [...new Set([...toStringArray(legacy), ...toStringArray(canonical)])];
}

/**
 * Warn before a legacy `allow` list is promoted into the enforced `allowlist`.
 *
 * Reading both spellings as one list is restriction-preserving on the deny side
 * — a denylist match wins over everything upstream — but the allow side runs the
 * other way: a pattern Vibe was ignoring becomes one it unconditionally permits,
 * and `_is_unconditionally_allowed` grants an allowlist match even under
 * `permission = "never"`. Dropping the legacy list instead would be its own
 * silent change, so the promotion stands and is announced.
 */
function warnOnLegacyAllowPromotion({
  vibeToolNames,
  tools,
  warned,
  logger,
}: {
  vibeToolNames: readonly string[];
  tools: Record<string, VibeToolConfig>;
  warned: Set<string>;
  logger?: Logger;
}): void {
  for (const vibeToolName of vibeToolNames) {
    if (warned.has(vibeToolName)) {
      continue;
    }
    const toolConfig = readVibeToolConfig({ tools, vibeToolName });
    const enforced = new Set(toStringArray(toolConfig.allowlist));
    const promoted = toStringArray(toolConfig.allow).filter((pattern) => !enforced.has(pattern));
    if (promoted.length === 0) {
      continue;
    }
    warned.add(vibeToolName);
    logger?.warn(
      `Promoting ${promoted.join(", ")} from the legacy 'allow' key of [tools.${vibeToolName}] ` +
        `into its 'allowlist', which is the key Vibe's permission engine actually reads. Those ` +
        `patterns were inert on disk and become unconditionally allowed — even under ` +
        `permission = "never" — so delete them from config.toml if the legacy list was stale.`,
    );
  }
}

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
  // Null-prototype so a `denylist = ["__proto__"]` entry imports as a real rule
  // instead of a silently-dropped assignment to the object's prototype.
  const created: Record<string, PermissionAction> = Object.create(null);
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

/** Compares two pattern lists as sets: authoring order carries no meaning. */
function arePatternListsEqual(a: string[], b: string[]): boolean {
  if (a.length !== b.length) {
    return false;
  }
  const sortedB = [...b].toSorted();
  return [...a].toSorted().every((pattern, index) => pattern === sortedB[index]);
}
