import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import { QWENCODE_DIR, QWENCODE_SETTINGS_FILE_NAME } from "../../constants/qwencode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type {
  PermissionAction,
  PermissionsConfig,
  QwencodePermissionsOverride,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { fallbackLogger, type Logger, warnWithFallback } from "../../utils/logger.js";
import { quoteValueForWarning } from "../../utils/quote-value.js";
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
 * Qwen Code uses a settings.json file in `.qwen/` (project) or `~/.qwen/` (global).
 * The shape mirrors Claude Code's `permissions.allow/ask/deny` arrays with
 * entries like `Bash(<pattern>)`, `Read(<pattern>)`, etc.
 */

const QwenSettingsPermissionsSchema = z.looseObject({
  allow: z.optional(z.array(z.string())),
  ask: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
});

const QwenSettingsSchema = z.looseObject({
  permissions: z.optional(QwenSettingsPermissionsSchema),
});

type QwenSettings = z.infer<typeof QwenSettingsSchema>;

// Shared fallback logger used by the importing direction (toRulesyncPermissions), where the
// instance method has no `logger` parameter. The exporting direction (fromRulesyncPermissions)
// forwards the caller-supplied logger explicitly. Unlike a private ConsoleLogger instance,
// `fallbackLogger` is configured from CLI flags and the resolved config, so `silent` is honored.
const moduleLogger: Logger = fallbackLogger;

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Qwen Code tool names (PascalCase).
 * Unknown names pass through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_QWEN_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  agent: "Agent",
};

const QWEN_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_QWEN_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toQwenToolName(canonical: string): string {
  return CANONICAL_TO_QWEN_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(qwenName: string): string {
  return QWEN_TO_CANONICAL_TOOL_NAMES[qwenName] ?? qwenName;
}

type ParsedQwenEntry =
  | { ok: true; toolName: string; pattern: string }
  | { ok: false; toolName: string; raw: string };

function parseQwenPermissionEntry(
  entry: string,
  options: { logger?: Logger } = {},
): ParsedQwenEntry {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { ok: true, toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Use `lastIndexOf(')')` so patterns containing nested parentheses (e.g. `Bash(echo (a))`) round-trip
  // without truncating the inner content. If no closing paren is found, the entry is malformed.
  const lastParenIndex = entry.lastIndexOf(")");
  if (lastParenIndex < parenIndex) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' is missing a closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  // The entry MUST end with the last `)` — anything trailing it (e.g. `Bash(...)x`) is malformed.
  if (lastParenIndex !== entry.length - 1) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' has trailing characters after the closing parenthesis.`,
    );
    return { ok: false, toolName, raw: entry };
  }
  const pattern = entry.slice(parenIndex + 1, lastParenIndex);
  return { ok: true, toolName, pattern: pattern || "*" };
}

function buildQwenPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

// The `tools`/`security` sub-keys that the `qwencode` override authors and that
// round-trip back into it on import. Kept explicit so unrelated `tools`/
// `security` keys are not pulled into the canonical model on import. The
// deprecated `tools.exclude` is intentionally excluded — Qwen recommends
// expressing those denials via `permissions.deny`, which the shared block owns.
const QWEN_OVERRIDE_TOOLS_KEYS = [
  "approvalMode",
  "autoAccept",
  "sandbox",
  "sandboxImage",
  "disabled",
  // Deferred tool names made visible at startup without tool_search (union
  // merge across scopes) — the counterpart of the `disabled` registry control.
  // Added in Qwen Code v0.19.7. https://github.com/QwenLM/qwen-code/pull/6372
  "visible",
  // `{ enabled: boolean }` toggle for the built-in `list_directory` tool, off by
  // default because `glob` covers the same ground. Added in Qwen Code v0.23.0.
  "listDirectory",
  // Enables the Workflow tool and the `/workflows` command. Added in Qwen Code
  // v0.23.0 and honored in user/system settings only — see
  // `QWEN_SCOPED_TOOLS_KEYS`. `QWEN_CODE_ENABLE_WORKFLOWS` and
  // `QWEN_CODE_DISABLE_WORKFLOWS` override it either way (disable wins), so a
  // value written here is not the last word.
  // https://github.com/QwenLM/qwen-code/pull/9098
  "workflowsEnabled",
] as const;
// `allowedHttpHookUrls` (URL patterns allowed as `type: "http"` hook targets; an
// empty list means allow-all) and `allowPrivateNetworkHooks` (relaxes the SSRF
// private-IP check) gate the HTTP hooks rulesync emits. Both are authored through
// the override's `security` group, as is `allowedInsecureVoiceBaseUrls` — the
// base URLs a voice provider may be reached at over cleartext HTTP or a private
// address, which also carries the provider API key in its `Authorization` header.
const QWEN_OVERRIDE_SECURITY_KEYS = [
  "folderTrust",
  "allowedHttpHookUrls",
  "allowPrivateNetworkHooks",
  "allowedInsecureVoiceBaseUrls",
] as const;

/**
 * How upstream Qwen Code treats an override key that a Workspace (project)
 * settings file sets, for the keys where that differs from "the workspace value
 * simply wins".
 *
 * - `workspace-stripped` — named in `WORKSPACE_RESTRICTED_SETTINGS`
 *   (`packages/cli/src/config/settingsUtils.ts`) and removed from workspace
 *   settings before the merge, so a project-scoped value is dead configuration.
 *   That list also names `agents.crossSessionMessaging`,
 *   `agents.crossSessionInbound` and `goals.modelProposed`, which sit in settings
 *   groups the `qwencode` override does not author at all.
 * - `workspace-non-overriding` — named in `WORKSPACE_NON_OVERRIDING_SETTINGS`.
 *   A workspace value survives only while no user, system, or system-defaults
 *   scope sets the key: a repository may narrow where its own hooks send data,
 *   but never replace a whitelist the user configured, because an empty list
 *   means allow-all.
 * - `user-scope-trust-check` — read once before the merge runs at all. Qwen Code
 *   makes the initial trust decision from system + user settings only
 *   (`loadSettings`' `initialTrustCheckSettings`), so a project-scoped value
 *   cannot decide whether its own workspace is trusted. It is not stripped,
 *   though: once the workspace is trusted the merged value still drives the
 *   folder-trust feature itself.
 * - `global-machine-wide` — not scope-restricted at all; Qwen Code honors it
 *   wherever it is written. It is listed because writing it into the global file
 *   settles how much the agent may do on its own for every project on the
 *   machine, which is worth naming even though no scope forbids it.
 * - `unmodeled` — the fallback for any other key the override carries. The
 *   `tools`/`security` schemas are `z.looseObject`s so a key Qwen Code adds
 *   works before rulesync knows about it, and some of those keys are as
 *   powerful as the modeled ones (`tools.discoveryCommand`, for instance, is
 *   spawned at startup). Rulesync cannot describe what it does not model, so it
 *   writes the key and names it rather than staying silent.
 */
type QwenScopeRule =
  | "workspace-stripped"
  | "workspace-non-overriding"
  | "user-scope-trust-check"
  | "global-machine-wide"
  | "unmodeled";

/**
 * A key paired with the scope rule that governs it. `globalNote` overrides the
 * rule's own sentence for a key the rule's wording does not fit — the rules say
 * what a scope does with a key, and only the key knows what it means.
 */
type QwenScopedKey<Key extends string> = {
  readonly key: Key;
  readonly rule: QwenScopeRule;
  readonly globalNote?: string;
};

/**
 * What each rule means for the two directions, so a key's behavior is declared
 * once beside its rule rather than spelled out at every branch.
 *
 * `stripInProjectScope` separates the keys a project file cannot use at all from
 * the ones whose project value still does something, just not unconditionally —
 * only the former are dropped. `announceOnlyGrants` marks the rule whose risk is
 * a value that turns something on; for the others the dangerous value is often
 * the falsy one (an empty allow-all list, folder trust switched off, a sandbox
 * turned off), so every change is announced instead. `announceOnImport` marks
 * the keys whose meaning depends on the scope they are written in — importing
 * one and regenerating globally turns a value a workspace could not decide for
 * itself into one Qwen Code enforces everywhere. `global-machine-wide` keys are
 * honored identically in either scope, so import neither promotes nor weakens
 * them and the announcement on the generate side is the control point.
 * `projectNote` is `null` for a rule that has nothing to say about the project
 * scope. A `globalNote` here is the rule's default; a key whose meaning the
 * default does not describe carries its own.
 */
const QWEN_SCOPE_RULES: Record<
  QwenScopeRule,
  {
    stripInProjectScope: boolean;
    announceOnlyGrants: boolean;
    announceOnImport: boolean;
    projectNote: ((qualifiedKey: string, filePath: string) => string) | null;
    globalNote: string;
  }
> = {
  "workspace-stripped": {
    stripInProjectScope: true,
    announceOnlyGrants: true,
    announceOnImport: true,
    projectNote: (qualifiedKey, filePath) =>
      `'${qualifiedKey}' is only honored in user/system settings, so it is skipped for the project-scoped ${filePath} (a value already in that file is left as it is). Author it in the global scope instead.`,
    globalNote:
      "Qwen Code ignores this key in workspace settings so a repository cannot grant it per project; in the global scope it applies to every project on this machine.",
  },
  "workspace-non-overriding": {
    stripInProjectScope: false,
    announceOnlyGrants: false,
    announceOnImport: true,
    projectNote: (qualifiedKey, filePath) =>
      `'${qualifiedKey}' was written to the project-scoped ${filePath}, but Qwen Code honors a workspace value for it only while no user, system, or system-defaults scope sets the key — a repository cannot replace the list a user configured in a higher scope. It does replace one written by hand in this same file, and an empty list is Qwen Code's allow-all, so check what it now says. Author it in the global scope if it has to apply unconditionally.`,
    globalNote:
      "A global value outranks every repository's own list for this key, and an empty list means allow-all, so this decides where HTTP hooks may send data for every project on this machine.",
  },
  "user-scope-trust-check": {
    stripInProjectScope: false,
    announceOnlyGrants: false,
    announceOnImport: true,
    projectNote: (qualifiedKey, filePath) =>
      `'${qualifiedKey}' was written to the project-scoped ${filePath}, but Qwen Code makes the initial trust decision from user and system settings alone, before a workspace file is merged, so a project value cannot decide whether this workspace is trusted (it still drives folder trust once the workspace is trusted). Author it in the global scope to decide it.`,
    globalNote:
      "Qwen Code reads this key from the global scope when it decides whether a workspace is trusted, so this changes which projects on this machine it trusts.",
  },
  "global-machine-wide": {
    stripInProjectScope: false,
    announceOnlyGrants: false,
    announceOnImport: false,
    projectNote: null,
    globalNote:
      "Qwen Code honors this key wherever it is written, so in the global scope it settles how much the agent may do unattended — how far approvals are skipped, and whether tool calls are contained at all — for every project on this machine.",
  },
  unmodeled: {
    stripInProjectScope: false,
    announceOnlyGrants: false,
    announceOnImport: false,
    projectNote: null,
    globalNote:
      "This is not a key rulesync models, so it cannot say what Qwen Code does with it — and some settings in these groups are potent (`tools.discoveryCommand` and `tools.callCommand` are spawned as commands when Qwen Code starts). Check what it now says for every project on this machine.",
  },
};

// Which keys each rule covers, transcribed from Qwen Code's own
// `WORKSPACE_RESTRICTED_SETTINGS` and `WORKSPACE_NON_OVERRIDING_SETTINGS` in
// `packages/cli/src/config/settingsUtils.ts`, verified against v0.23.0. Upstream
// may add entries; an addition rulesync has not picked up means it writes a key
// Qwen Code now ignores, so re-check these lists when supporting a new version.
const QWEN_SCOPED_TOOLS_KEYS: readonly QwenScopedKey<(typeof QWEN_OVERRIDE_TOOLS_KEYS)[number]>[] =
  [
    { key: "workflowsEnabled", rule: "workspace-stripped" },
    // The autonomy and containment controls. Qwen Code accepts them in any scope,
    // but `approvalMode: "yolo"`, `autoAccept`, a disabled `sandbox` or a
    // `sandboxImage` naming someone else's image are exactly the settings a global
    // write should not slip past — the same relaxations the deepagents adapter
    // announces at startup.
    { key: "approvalMode", rule: "global-machine-wide" },
    { key: "autoAccept", rule: "global-machine-wide" },
    { key: "sandbox", rule: "global-machine-wide" },
    {
      key: "sandboxImage",
      rule: "global-machine-wide",
      // Not about whether tool calls are contained, but about what contains them.
      globalNote:
        "Qwen Code honors this key wherever it is written, so in the global scope every sandboxed run on this machine executes inside the named image — check that it is one you trust to run your code.",
    },
    {
      key: "disabled",
      rule: "global-machine-wide",
      // Stronger than `permissions.deny`: a disabled tool is never registered, so
      // the model cannot discover it at all. The override replaces the list
      // wholesale, so writing a shorter one re-registers what it leaves out.
      globalNote:
        "Qwen Code honors this key wherever it is written, and the override replaces the list rather than adding to it, so in the global scope this decides which tools stay out of the registry — and which are handed back to the model — for every project on this machine.",
    },
    {
      key: "visible",
      rule: "global-machine-wide",
      globalNote:
        "Qwen Code honors this key wherever it is written, so in the global scope this decides which deferred tools are visible at startup for every project on this machine.",
    },
  ];
const QWEN_SCOPED_SECURITY_KEYS: readonly QwenScopedKey<
  (typeof QWEN_OVERRIDE_SECURITY_KEYS)[number]
>[] = [
  { key: "allowPrivateNetworkHooks", rule: "workspace-stripped" },
  { key: "allowedInsecureVoiceBaseUrls", rule: "workspace-stripped" },
  { key: "allowedHttpHookUrls", rule: "workspace-non-overriding" },
  { key: "folderTrust", rule: "user-scope-trust-check" },
];

// The `tools` and `security` groups the override patches, paired with the keys
// it owns there and the ones whose scope behavior needs a note (an empty list is
// fine for a group that has none). Both directions read it — the generate-side
// scope gate and the import-side extraction and promotion warning — so a key
// cannot be wired into one of them and forgotten in the other. The override's
// third surface, `permissions.autoMode`, is not a settings group of its own and
// is handled separately at each call site.
const QWEN_OVERRIDE_GROUPS = [
  {
    groupName: "tools",
    overrideKeys: QWEN_OVERRIDE_TOOLS_KEYS,
    scopedKeys: QWEN_SCOPED_TOOLS_KEYS,
  },
  {
    groupName: "security",
    overrideKeys: QWEN_OVERRIDE_SECURITY_KEYS,
    scopedKeys: QWEN_SCOPED_SECURITY_KEYS,
  },
] as const;
type QwenOverrideGroupName = (typeof QWEN_OVERRIDE_GROUPS)[number]["groupName"];
// The `permissions` sub-keys the `qwencode` override authors. `autoMode` (the
// Auto Mode classifier config) is a sibling of `allow`/`ask`/`deny` under
// `permissions` with no canonical category, so it round-trips through the
// override rather than the shared allow/ask/deny arrays.
const QWEN_OVERRIDE_PERMISSIONS_KEYS = ["autoMode"] as const;

function asPlainRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

/** Pick the override-managed keys out of a settings group into a fresh record. */
function pickQwenOverrideKeys(group: unknown, keys: readonly string[]): Record<string, unknown> {
  const source = asPlainRecord(group);
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (source[key] !== undefined) picked[key] = source[key];
  }
  return picked;
}

/**
 * Whether a value written for a scoped key actually grants something. Qwen Code
 * reads the boolean ones with a plain truthiness check, so anything truthy turns
 * the capability on — `1` and the string `"false"` included, which is why this is
 * not a `=== true` test. Not all of them are booleans either:
 * `security.allowedInsecureVoiceBaseUrls` is a list of base URLs, and an empty
 * list grants nothing.
 *
 * Only the rules whose `announceOnlyGrants` is set consult this, because "empty"
 * does not mean the same thing for every list: an empty
 * `security.allowedHttpHookUrls` is Qwen Code's allow-all, the widest value there
 * is, so that key is announced whatever it says.
 */
function grantsSomething(value: unknown): boolean {
  return Array.isArray(value) ? value.length > 0 : Boolean(value);
}

/**
 * Compare two settings values without letting key order decide the answer, so
 * re-emitting `{ enabled: true, note: "x" }` as `{ note: "x", enabled: true }`
 * is not announced as a change.
 */
function stableStringify(value: unknown): string {
  return (
    JSON.stringify(value, (_key, nested: unknown) =>
      nested !== null && typeof nested === "object" && !Array.isArray(nested)
        ? Object.fromEntries(
            Object.entries(nested as Record<string, unknown>).toSorted(([left], [right]) =>
              left.localeCompare(right),
            ),
          )
        : nested,
    ) ?? "undefined"
  );
}

function sameSettingsValue(a: unknown, b: unknown): boolean {
  return stableStringify(a) === stableStringify(b);
}

/**
 * Apply the scope rules for a settings group's scoped keys.
 *
 * Generating project settings drops the keys Qwen Code strips from a workspace
 * file before the merge — writing one there would be dead configuration — and
 * explains the keys whose project value is honored only conditionally rather
 * than dropping those. Either way only the override copy is touched, so a value
 * the user already wrote into the project file stays where it is.
 *
 * Generating global settings keeps every key, and announces the write: the
 * `.rulesync/permissions.jsonc` carrying it may have arrived with a cloned or
 * fetched repository, and the global file applies to every project on this
 * machine. So the new value is named alongside the one it replaces, exactly as
 * the deepagents startup override announces its own relaxations. Every key the
 * override writes is announced, not only the ones with a scope rule — the
 * groups are `z.looseObject`s, so an unmodeled key falls back to the
 * `unmodeled` rule rather than slipping past the gate that the modeled ones
 * pass through.
 */
function scopeOverrideGroup(
  overrideGroup: unknown,
  {
    groupName,
    scopedKeys,
    existingGroup,
    global,
    filePath,
    logger,
  }: {
    groupName: QwenOverrideGroupName;
    scopedKeys: readonly QwenScopedKey<string>[];
    existingGroup: unknown;
    global: boolean;
    filePath: string;
    logger?: Logger;
  },
): Record<string, unknown> {
  const scoped = { ...asPlainRecord(overrideGroup) };
  const previous = asPlainRecord(existingGroup);
  const rulesByKey = new Map(scopedKeys.map((scopedKey) => [scopedKey.key, scopedKey]));
  for (const key of Object.keys(scoped)) {
    const value = scoped[key];
    if (value === undefined) continue;
    const scopedKey = rulesByKey.get(key);
    const rule = scopedKey?.rule ?? "unmodeled";
    const { stripInProjectScope, announceOnlyGrants, projectNote } = QWEN_SCOPE_RULES[rule];
    const globalNote = scopedKey?.globalNote ?? QWEN_SCOPE_RULES[rule].globalNote;
    const previousValue = previous[key];
    // A value the file already had changes nothing, and neither does one that
    // grants nothing under a rule whose risk is the granting direction — warning
    // about either would only bury the writes that do change what Qwen Code does.
    const unchanged = sameSettingsValue(previousValue, value);
    if (!global) {
      // A stripped key is dropped whatever the file says, so the notice is about
      // what rulesync refused to write and is always worth printing. The keys
      // that are actually written report a change, so a re-run that writes the
      // same value again says nothing.
      if (stripInProjectScope) delete scoped[key];
      else if (unchanged) continue;
      if (projectNote) {
        warnWithFallback(
          logger,
          `Qwen permissions: ${projectNote(`${groupName}.${key}`, filePath)}`,
        );
      }
      continue;
    }
    if (unchanged) continue;
    if (announceOnlyGrants && !grantsSomething(value)) continue;
    const replaced =
      previousValue === undefined ? "" : ` (was ${quoteValueForWarning(previousValue)})`;
    warnWithFallback(
      logger,
      `Qwen permissions: the qwencode override wrote '${groupName}.${key}' = ${quoteValueForWarning(value)}${replaced} into ${filePath}, your global Qwen Code settings. ${globalNote}`,
    );
  }
  return scoped;
}

/**
 * Build the `tools`/`security` patch groups contributed by the `qwencode`
 * override. Each group is shallow-merged over what `settings.json` already has,
 * after the scope gate has handled the keys Qwen Code honors in one scope only.
 */
function buildOverrideGroupsPatch({
  settings,
  override,
  global,
  filePath,
  logger,
}: {
  settings: QwenSettings;
  override: QwencodePermissionsOverride | undefined;
  global: boolean;
  filePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  for (const { groupName, scopedKeys } of QWEN_OVERRIDE_GROUPS) {
    const overrideGroup = override?.[groupName];
    if (overrideGroup === undefined) continue;
    const existingGroup = settings[groupName];
    const scoped = scopeOverrideGroup(overrideGroup, {
      groupName,
      scopedKeys,
      existingGroup,
      global,
      filePath,
      logger,
    });
    const merged = { ...asPlainRecord(existingGroup), ...scoped };
    // An override whose only key was scoped away leaves nothing to write, so do
    // not add an empty group object to a file that had none.
    if (Object.keys(merged).length > 0) {
      patch[groupName] = merged;
    }
  }
  return patch;
}

/**
 * Warn about a scoped key lifted out of a *project* settings file being
 * imported. The file carries no scope marker, so import keeps the key either
 * way — but regenerating in the global scope would turn a value a workspace
 * could not decide for itself into one Qwen Code enforces everywhere, and a
 * settings file read out of a cloned repository is exactly where such a value
 * comes from. Importing the global file is the case this has nothing to say
 * about: the value is already in the scope the warning would send it to.
 */
function warnAboutImportedScopedKeys(
  groups: Record<QwenOverrideGroupName, Record<string, unknown>>,
): void {
  for (const { groupName, scopedKeys } of QWEN_OVERRIDE_GROUPS) {
    const group = groups[groupName];
    for (const scopedKey of scopedKeys) {
      const { key, rule } = scopedKey;
      const value = group[key];
      if (value === undefined) continue;
      const { announceOnlyGrants, announceOnImport } = QWEN_SCOPE_RULES[rule];
      if (!announceOnImport) continue;
      // Under a rule whose risk is the granting direction, only a granting value
      // is worth flagging; see `scopeOverrideGroup`.
      if (announceOnlyGrants && !grantsSomething(value)) continue;
      const globalNote = scopedKey.globalNote ?? QWEN_SCOPE_RULES[rule].globalNote;
      moduleLogger.warn(
        `Qwen permissions: imported '${groupName}.${key}' = ${quoteValueForWarning(value)}. ${globalNote} Review it before generating with the global scope.`,
      );
    }
  }
}

export class QwencodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
    // Mirror `RulesyncPermissions` so that `fromFile({ validate: true })` actually
    // verifies schema conformance and throws on malformed input. Without this
    // wiring, the `validate()` method exists but is never invoked at construction
    // time, so callers reading `validate: true` would falsely assume validation
    // already ran.
    if (params.validate) {
      const result = this.validate();
      if (!result.success) {
        throw result.error;
      }
    }
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: QWENCODE_DIR,
      relativeFilePath: QWENCODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      // Forwarded so `toRulesyncPermissions()` knows which scope it read, which
      // decides whether the promotion warning applies; `AiFile` records it.
      global,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Read without initializing so generation has no filesystem side effects
    // when the destination directory does not yet exist (important for dry-run);
    // the actual write happens later in `writeAiFiles`.
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(existingContent);
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing Qwen settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToQwenPermissions(config);

    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toQwenToolName(category)),
    );

    const existingPermissions = settings.permissions ?? {};
    // For preservation filtering we only need the tool name; whether the entry is malformed is
    // irrelevant here since we are forwarding it verbatim back into the merged output.
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry, { logger }).toolName),
    );

    const mergedPermissions: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
      [k: string]: unknown;
    } = {
      ...existingPermissions,
    };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedAsk = uniq([...preservedAsk, ...ask].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    if (mergedAllow.length > 0) {
      mergedPermissions.allow = mergedAllow;
    } else {
      delete mergedPermissions.allow;
    }
    if (mergedAsk.length > 0) {
      mergedPermissions.ask = mergedAsk;
    } else {
      delete mergedPermissions.ask;
    }
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    const override = config.qwencode;

    // Overlay the Qwen-scoped override's `permissions.autoMode` (the Auto Mode
    // classifier config). It has no canonical category and would otherwise be
    // dropped on round-trip. Replaces the existing `autoMode` wholesale, matching
    // how the override's nested objects (e.g. `security.folderTrust`) behave.
    if (override?.autoMode !== undefined) {
      mergedPermissions.autoMode = override.autoMode;
    }

    const patch: Record<string, unknown> = { permissions: mergedPermissions };

    // Overlay the Qwen-scoped override's `tools`/`security` groups (autonomy and
    // sandbox settings). Shallow-merged at the top level of each group, so an
    // unrelated sibling key (e.g. `tools.core`) is preserved while an override
    // key wins; a nested object the override supplies (e.g. `security.folderTrust`)
    // replaces the existing one wholesale rather than being deep-merged.
    Object.assign(
      patch,
      buildOverrideGroupsPatch({
        settings,
        override,
        global,
        // Named in warnings only, so keep it relative: the sibling adapters do,
        // and a global run would otherwise put a home directory into the message.
        filePath: join(paths.relativeDirPath, paths.relativeFilePath),
        logger,
      }),
    );

    const fileContent = applySharedConfigPatch({
      fileKey: sharedConfigFileKey(paths),
      feature: "permissions",
      existingContent,
      patch,
      filePath,
    });

    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse Qwen permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertQwenToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

    // Route Qwen's autonomy/sandbox settings into the `qwencode` override — they
    // have no canonical category and would otherwise be dropped on round-trip.
    // Import lifts every override-managed key regardless of scope: the file being
    // read carries no scope marker, and dropping a global-only key here would lose
    // a user's real setting. The scope gate lives on the generate side.
    const overrideGroups = {} as Record<QwenOverrideGroupName, Record<string, unknown>>;
    for (const { groupName, overrideKeys } of QWEN_OVERRIDE_GROUPS) {
      overrideGroups[groupName] = pickQwenOverrideKeys(settings[groupName], overrideKeys);
    }
    // Only a project file's values would be promoted by regenerating globally;
    // a global file's are already there.
    if (!this.global) warnAboutImportedScopedKeys(overrideGroups);
    const overridePermissions = pickQwenOverrideKeys(
      settings.permissions,
      QWEN_OVERRIDE_PERMISSIONS_KEYS,
    );
    const qwencodeOverride: Record<string, unknown> = {};
    for (const { groupName } of QWEN_OVERRIDE_GROUPS) {
      const group = overrideGroups[groupName];
      if (Object.keys(group).length > 0) qwencodeOverride[groupName] = group;
    }
    if (overridePermissions.autoMode !== undefined) {
      qwencodeOverride.autoMode = overridePermissions.autoMode;
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(qwencodeOverride).length > 0) {
      result.qwencode = qwencodeOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    // Mirror Kilo's `safeParse`-based pattern: actually verify that the file
    // content is JSON-parseable and conforms to the Qwen settings schema.
    // A no-op validate would let malformed files slip past the
    // generate/import boundary and surface as confusing errors deeper in the
    // pipeline.
    try {
      const parsed = JSON.parse(this.fileContent || "{}");
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        return { success: false, error: result.error };
      }
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Qwen permissions JSON: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): QwencodePermissions {
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

function convertRulesyncToQwenPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const qwenToolName = toQwenToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildQwenPermissionEntry(qwenToolName, pattern);
      switch (action) {
        case "allow":
          allow.push(entry);
          break;
        case "ask":
          ask.push(entry);
          break;
        case "deny":
          deny.push(entry);
          break;
      }
    }
  }

  return { allow, ask, deny };
}

function convertQwenToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
  logger?: Logger;
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};
  // Forward a logger to `parseQwenPermissionEntry` so its malformed-entry warnings are not
  // dead code in production. Default to the module-level ConsoleLogger when the caller did not
  // supply one (the instance-side `toRulesyncPermissions()` has no logger parameter to thread).
  const logger = params.logger ?? moduleLogger;

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const parsed = parseQwenPermissionEntry(entry, { logger });
      if (!parsed.ok) {
        // Fail-closed asymmetry by category:
        // - `deny`: keep the existing fallback to `*` so a malformed deny still blocks (broader is safer).
        // - `allow` / `ask`: dropping is safer than broadening a narrow user rule into `*`. The
        //   already-emitted warn from `parseQwenPermissionEntry` makes the drop visible.
        if (action === "deny") {
          const canonical = toCanonicalToolName(parsed.toolName);
          if (!permission[canonical]) {
            permission[canonical] = {};
          }
          permission[canonical]["*"] = action;
        }
        continue;
      }
      const { toolName, pattern } = parsed;
      const canonical = toCanonicalToolName(toolName);
      if (!permission[canonical]) {
        permission[canonical] = {};
      }
      permission[canonical][pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}
