import { join } from "node:path";

import { CLAUDECODE_DIR, CLAUDECODE_SETTINGS_FILE_NAME } from "../../constants/claudecode-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { stripControlCharacters } from "../../utils/control-characters.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { PROTOTYPE_POLLUTION_KEYS } from "../../utils/prototype-pollution.js";
import {
  applyPermissions,
  CLAUDE_SETTINGS_SHARED_FILE_KEY,
  SHARED_CONFIG_OWNERSHIP,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Claude Code tool names (PascalCase).
 * Unknown names are passed through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  agent: "Agent",
};

/**
 * Reverse mapping from Claude Code tool names to rulesync canonical names.
 */
const CLAUDE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toClaudeToolName(canonical: string): string {
  return CANONICAL_TO_CLAUDE_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(claudeName: string): string {
  return CLAUDE_TO_CANONICAL_TOOL_NAMES[claudeName] ?? claudeName;
}

/**
 * Parse a Claude Code permission entry like "Bash(npm run *)" into tool name and pattern.
 * If no parentheses, returns the tool name with "*" as the pattern.
 */
function parseClaudePermissionEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Verify closing parenthesis exists at the end before extracting the pattern
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Claude Code's file permission checks match only `Edit(path)` and `Read(path)`
 * rules. A `Write(path)`, `NotebookEdit(path)` or `Glob(path)` rule "is accepted
 * but never matched by those checks, so Claude Code warns at startup for each
 * allow, deny, or ask rule in one of these unmatched forms" — so a canonical
 * `write`/`notebookedit`/`glob` rule with a pattern is emitted in the form the
 * docs prescribe instead. A tool-name rule with no path is unaffected: it
 * matches the tool everywhere and produces no warning.
 * @see https://code.claude.com/docs/en/permissions
 */
function isPlainRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/**
 * Merge `patch` into `base`, recursing into plain objects so a sibling key at
 * any depth survives. Arrays and scalars are replaced, since a list the author
 * states is the list they mean.
 */
function deepMergeRecords(
  base: Record<string, unknown>,
  patch: Record<string, unknown>,
): Record<string, unknown> {
  const merged: Record<string, unknown> = { ...base };
  for (const [key, value] of Object.entries(patch)) {
    if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
    const existing = merged[key];
    merged[key] =
      isPlainRecord(existing) && isPlainRecord(value) ? deepMergeRecords(existing, value) : value;
  }
  return merged;
}

/**
 * `sandbox.*` paths Claude Code honors only from user settings, managed settings
 * and the `--settings` CLI flag. Written into a project `.claude/settings.json`
 * they are silently ignored, so a committed file would read as though it
 * enforced a sandbox policy while doing nothing — security-relevant for
 * `network.strictAllowlist` and the credential-masking keys in particular.
 * Generation therefore drops them at project scope with a per-key warning and
 * emits them only under `--global`.
 *
 * Deliberately NOT listed:
 * - `ripgrep` / `bwrapPath` / `socatPath`: each names an executable, so
 *   `CLAUDECODE_COMMAND_EXECUTING_SANDBOX_REFUSAL` refuses them in both scopes
 *   rather than emitting them under `--global`.
 * - `credentials.envVars` / `credentials.files`: the ignored-at-project-scope
 *   unit is the individual entry's mode, not the settings key, and the same
 *   lists carry `deny` entries that project settings *do* honor — dropping a
 *   whole list would remove real restrictions. `stripProjectIgnoredMaskEntries`
 *   filters those lists per entry instead.
 *
 * @see https://code.claude.com/docs/en/sandboxing
 */
const CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS: readonly (readonly string[])[] = [
  ["filesystem", "disabled"],
  ["network", "strictAllowlist"],
  ["network", "tlsTerminate"],
  ["credentials", "allowPlaintextInject"],
  ["credentials", "awsPairs"],
  ["credentials", "sigv4"],
  ["allowAppleEvents"],
];

/**
 * `sandbox.*` paths documented with a `Managed` scope: Claude Code reads them
 * only from the settings file an organization deploys. Neither file rulesync
 * writes is that file, so they are dropped in **both** scopes — the `sandbox`
 * counterpart of {@link CLAUDECODE_UNHONORED_KEY_SOURCES}, which does the same
 * for top-level `Managed` keys.
 *
 * Both only ever *narrow* the policy — they stop a lower-scoped file from
 * re-opening what managed settings blocked — so neither is trust-widening. They
 * are dropped rather than written for the opposite reason: written into a
 * project or user file they do nothing at all, and a `sandbox` block that reads
 * as though it locked the policy to managed values while Claude Code ignores it
 * is the more dangerous of the two failure modes.
 *
 * Import keeps them, unlike the command-executing paths: the value in an
 * existing `settings.json` was hand-written to be honored somewhere, and
 * round-tripping it preserves the author's intent for the day it moves into a
 * managed file. The cost is a warning on every generate until it is removed,
 * which the refusal message points at.
 *
 * @see https://code.claude.com/docs/en/settings-reference#sandbox-filesystem-allowmanagedreadpathsonly
 *   — "Scope: `Managed`"; the `network` entry says the same.
 */
const CLAUDECODE_MANAGED_ONLY_SANDBOX_PATHS: readonly (readonly string[])[] = [
  ["filesystem", "allowManagedReadPathsOnly"],
  ["network", "allowManagedDomainsOnly"],
];

/**
 * Walks `segments` from `root`, returning the record they name or `undefined` if
 * any step is missing or not a record. Shared by everything below that addresses
 * a `sandbox` path, so a nested path added to one of the tables is actually
 * traversed rather than silently skipped.
 */
function resolveSandboxParent({
  root,
  segments,
}: {
  root: Record<string, unknown>;
  segments: readonly string[];
}): Record<string, unknown> | undefined {
  let parent: Record<string, unknown> = root;
  for (const segment of segments) {
    const next = parent[segment];
    if (!isPlainRecord(next)) return undefined;
    parent = next;
  }
  return parent;
}

/**
 * Deletes `path` from `target` in place and reports whether anything was there,
 * dropping a container the removal emptied so no `"network": {}` noise is left
 * behind.
 */
function deleteSandboxPath({
  target,
  path,
}: {
  target: Record<string, unknown>;
  path: readonly string[];
}): boolean {
  const leaf = path.at(-1);
  if (leaf === undefined) return false;
  const parentPath = path.slice(0, -1);
  const parent = resolveSandboxParent({ root: target, segments: parentPath });
  if (parent === undefined || parent[leaf] === undefined) return false;
  delete parent[leaf];
  // Walk back out, dropping every container the removal emptied, so no
  // `"network": {}` — or `{"credentials":{"nested":{}}}` — is left behind.
  for (let depth = parentPath.length; depth > 0; depth--) {
    const container = resolveSandboxParent({ root: target, segments: parentPath.slice(0, depth) });
    if (container === undefined || Object.keys(container).length > 0) break;
    const holder = resolveSandboxParent({ root: target, segments: parentPath.slice(0, depth - 1) });
    const name = parentPath[depth - 1];
    if (holder === undefined || name === undefined) break;
    delete holder[name];
  }
  return true;
}

/**
 * One setting this generate is about to write that widens what Claude Code
 * trusts. `label` names the setting as it appears in the target file (with the
 * value spliced in where the value is what widens), and `reason` is the verb
 * phrase that completes "it ...". They are collected rather than logged one by
 * one so a file that sets many of them produces a single summary line instead
 * of a run of near-identical warnings.
 */
type TrustAffectingEntry = {
  readonly label: string;
  readonly reason: string;
};

/**
 * The one warning that names every trust-affecting setting this generate wrote
 * to `relativeFilePath`. Emitted once per file: the individual reasons are what
 * matter, but the "review this as you would a hook" framing only needs saying
 * once, and repeating it per key buries the reasons in boilerplate.
 */
function warnOnTrustAffectingEntries({
  entries,
  relativeFilePath,
  logger,
}: {
  entries: readonly TrustAffectingEntry[];
  relativeFilePath: string;
  logger?: Logger;
}): void {
  if (entries.length === 0) return;
  const one = entries.length === 1;
  const details = entries.map(({ label, reason }) => `'${label}' — ${reason}`).join("; ");
  logger?.warn(
    `Claude Code permissions: writing ${entries.length} trust-affecting ${one ? "setting" : "settings"} to ${relativeFilePath}; review ${one ? "it" : "them"} as you would a hook, especially if this permissions file came from 'rulesync fetch'. ${details}.`,
  );
}

/**
 * The `permissions.defaultMode` values that start a session with fewer prompts
 * than the default. `plan` and `default` are absent because they do not widen
 * anything.
 */
const CLAUDECODE_WIDENING_DEFAULT_MODES: Readonly<Record<string, string>> = {
  acceptEdits: "every file edit is then applied without a prompt",
  auto: "shell commands are then auto-approved by a classifier rather than by you",
  bypassPermissions: "every session then starts with no permission prompts at all",
};

/**
 * The `permissions` fields that widen rather than restrict: a `defaultMode` that
 * removes prompts, and `additionalDirectories`, which moves the
 * working-directory boundary. Reported for the same reason `disableAllHooks` is:
 * a shareable permissions file should not loosen the permission system quietly.
 */
function collectWideningPermissionFields({
  fields,
}: {
  fields: Record<string, unknown>;
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  const defaultMode = fields.defaultMode;
  if (
    typeof defaultMode === "string" &&
    Object.hasOwn(CLAUDECODE_WIDENING_DEFAULT_MODES, defaultMode)
  ) {
    entries.push({
      label: `permissions.defaultMode: "${defaultMode}"`,
      reason: CLAUDECODE_WIDENING_DEFAULT_MODES[defaultMode] as string,
    });
  }
  const additionalDirectories = fields.additionalDirectories;
  if (
    additionalDirectories !== undefined &&
    !(Array.isArray(additionalDirectories) && additionalDirectories.length === 0)
  ) {
    entries.push({
      label: "permissions.additionalDirectories",
      reason: "moves the boundary of what Claude Code may read and edit outside the project",
    });
  }
  return entries;
}

/**
 * `sandbox` paths whose value names a binary Claude Code runs. `sandbox` has its
 * own merge branch, so the top-level refusal in `stripUnhonoredTopLevelKeys`
 * never sees them — they are refused here on the same grounds, in both scopes:
 * a fetched `.rulesync/permissions.jsonc` must not be able to point Claude Code
 * at an executable of its choosing.
 *
 * @see https://code.claude.com/docs/en/sandboxing
 */
const CLAUDECODE_COMMAND_EXECUTING_SANDBOX_PATHS: readonly (readonly string[])[] = [
  ["ripgrep"],
  ["bwrapPath"],
  ["socatPath"],
];

/**
 * `sandbox` paths that loosen the sandbox rather than naming something to run:
 * they let commands out of it, weaken the isolation it provides, or redirect
 * where its traffic goes. They are written like `env` is — the ordinary uses are
 * too common to refuse — but never silently, because a fetched override should
 * not be able to open the sandbox without saying so. `widens` keeps the warning
 * to the value that actually loosens the policy, so authoring the restrictive
 * value (`allowUnsandboxedCommands: false`, an empty `excludedCommands`) stays
 * quiet. The `allow*` lists are here for a structural reason: Claude Code merges
 * a list across every settings scope rather than replacing it, so a project file
 * can only ever add to them. Their counterparts — `denyRead`, `denyWrite`,
 * `deniedDomains` — merge the same way, but adding to a deny list only ever
 * narrows the policy, so they are absent.
 *
 * @see https://code.claude.com/docs/en/sandboxing
 */
const CLAUDECODE_TRUST_AFFECTING_SANDBOX_PATHS: readonly {
  readonly path: readonly string[];
  readonly reason: string;
  readonly widens: (value: unknown) => boolean;
}[] = [
  {
    path: ["allowAppleEvents"],
    reason: "lets sandboxed commands send Apple Events, which removes code-execution isolation",
    widens: (value) => value === true,
  },
  {
    path: ["allowUnsandboxedCommands"],
    reason: "controls whether Claude may retry a blocked command outside the sandbox",
    // Documented default `true`, and this predicate reports that value too. It
    // is not redundant: a project `.claude/settings.json` outranks the user
    // file, so an explicit `true` from a fetched override re-opens the escape
    // hatch a user's `false` closed, and it does so without changing anything a
    // diff of the *effective* policy would show.
    widens: (value) => value !== false,
  },
  {
    path: ["autoAllowBashIfSandboxed"],
    reason: "controls whether every Bash command the sandbox accepts runs without a prompt",
    // Same reasoning as `allowUnsandboxedCommands`: default `true`, and a
    // project-scope `true` overrides a user-scope `false`.
    widens: (value) => value !== false,
  },
  {
    path: ["enableWeakerNestedSandbox"],
    reason: "runs the Linux sandbox inside an unprivileged container, which weakens it",
    widens: (value) => value === true,
  },
  {
    path: ["enableWeakerNetworkIsolation"],
    reason: "weakens the sandbox's network isolation on macOS",
    widens: (value) => value === true,
  },
  {
    path: ["enabled"],
    reason:
      "turns the sandbox on, and sandboxed Bash commands then run without a permission prompt unless `autoAllowBashIfSandboxed` is false",
    widens: (value) => value === true,
  },
  {
    path: ["excludedCommands"],
    reason: "names commands that always run outside the sandbox, with no sandbox policy applied",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["filesystem", "allowRead"],
    reason: "re-opens reading inside a region the sandbox's `denyRead` blocks",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["filesystem", "allowWrite"],
    reason: "adds paths sandboxed commands may write to, outside the working directory",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["ignoreViolations"],
    // An object mapping a command substring to the violations to hide. The
    // sandbox still blocks the access, so what widens here is what you get to
    // see, not what runs.
    reason: "hides the sandbox violations it names, so a blocked access stops being reported",
    widens: (value) => (isPlainRecord(value) ? Object.keys(value).length > 0 : value !== false),
  },
  {
    path: ["network", "allowAllUnixSockets"],
    reason: "lets sandboxed commands connect to every Unix socket",
    widens: (value) => value === true,
  },
  {
    path: ["network", "allowedDomains"],
    reason: "pre-allows domains sandboxed commands may reach without a prompt",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["network", "allowLocalBinding"],
    reason: "lets sandboxed commands bind local ports",
    widens: (value) => value === true,
  },
  {
    path: ["network", "allowMachLookup"],
    reason: "names the macOS services sandboxed commands may reach, and `*` means every service",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["network", "allowUnixSockets"],
    reason:
      "names Unix sockets sandboxed commands may reach, and one such as `/var/run/docker.sock` is host access",
    widens: (value) => !Array.isArray(value) || value.length > 0,
  },
  {
    path: ["network", "httpProxyPort"],
    reason: "routes the sandbox's HTTP traffic through the port it names",
    widens: () => true,
  },
  {
    path: ["network", "socksProxyPort"],
    reason: "routes the sandbox's SOCKS traffic through the port it names",
    widens: () => true,
  },
];

/**
 * Every authored `sandbox` path that loosens the sandbox. Nothing is removed —
 * the values are written, just not silently. Called on the filtered `sandbox`
 * so it never claims to be writing a path the scope filters dropped.
 */
function collectTrustAffectingSandboxPaths({
  sandbox,
}: {
  sandbox: Record<string, unknown>;
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  for (const { path, reason, widens } of CLAUDECODE_TRUST_AFFECTING_SANDBOX_PATHS) {
    const leaf = path.at(-1);
    if (leaf === undefined) continue;
    const parent = resolveSandboxParent({ root: sandbox, segments: path.slice(0, -1) });
    if (parent === undefined) continue;
    const value = parent[leaf];
    if (value === undefined || !widens(value)) continue;
    entries.push({ label: `sandbox.${path.join(".")}`, reason });
  }
  return entries;
}

/**
 * One class of `sandbox` paths rulesync refuses to write, paired with the
 * warning that explains the refusal. The three classes differ only in the table
 * they scan and the remediation they name, so they share `stripSandboxPaths`
 * rather than each carrying a copy of the walk.
 */
type SandboxPathRefusal = {
  readonly paths: readonly (readonly string[])[];
  readonly warn: (args: { readonly label: string; readonly relativeFilePath: string }) => string;
};

/** Paths that name an executable Claude Code runs. Refused in both scopes. */
const CLAUDECODE_COMMAND_EXECUTING_SANDBOX_REFUSAL: SandboxPathRefusal = {
  paths: CLAUDECODE_COMMAND_EXECUTING_SANDBOX_PATHS,
  warn: ({ label, relativeFilePath }) =>
    `Claude Code permissions: '${label}' names an executable Claude Code runs, so rulesync does not write it to ${relativeFilePath}. A permissions file is shareable — 'rulesync fetch' copies one into a project — and is not where a reviewer looks for a command to run; set this path in ${relativeFilePath} by hand.`,
};

/**
 * Paths Claude Code honors only from managed settings. Refused in both scopes,
 * like the command-executing paths, because managed settings are not a file
 * rulesync writes in either of them.
 */
const CLAUDECODE_MANAGED_ONLY_SANDBOX_REFUSAL: SandboxPathRefusal = {
  paths: CLAUDECODE_MANAGED_ONLY_SANDBOX_PATHS,
  warn: ({ label, relativeFilePath }) =>
    `Claude Code permissions: '${label}' is only honored in managed settings, which rulesync does not generate, so it is not written to ${relativeFilePath}. Set it in the managed settings file by hand, and check ${relativeFilePath} for a stale value an earlier generate may have left there.`,
};

/** Paths Claude Code honors only above project scope. Refused at project scope. */
const CLAUDECODE_GLOBAL_ONLY_SANDBOX_REFUSAL: SandboxPathRefusal = {
  paths: CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS,
  warn: ({ label, relativeFilePath }) =>
    `Claude Code permissions: '${label}' is only honored in user/managed/--settings settings, so it is not written to the project-scoped ${relativeFilePath}. Author it in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
};

/**
 * Copy of the authored `sandbox` override with every path of every passed
 * refusal removed, warning once per dropped path. Only the override copy is
 * filtered — a value already hand-written in the target file is left untouched,
 * matching the `qwencode` `security.allowPrivateNetworkHooks` precedent.
 */
function stripSandboxPaths({
  sandbox,
  refusals,
  relativeFilePath,
  logger,
}: {
  sandbox: Record<string, unknown>;
  refusals: readonly SandboxPathRefusal[];
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const filtered = structuredClone(sandbox);
  for (const { paths, warn } of refusals) {
    for (const path of paths) {
      if (!deleteSandboxPath({ target: filtered, path })) continue;
      logger?.warn(warn({ label: `sandbox.${path.join(".")}`, relativeFilePath }));
    }
  }
  return filtered;
}

/** The `sandbox.credentials` lists whose entries accept `"mode": "mask"`. */
const CLAUDECODE_MASKABLE_CREDENTIAL_LISTS = ["envVars", "files"] as const;

/**
 * Copy of the authored `sandbox` override with the `credentials.envVars` /
 * `credentials.files` entries whose `mode` is `"mask"` removed, warning once per
 * list.
 *
 * Masking authorizes the sandbox proxy to send the real credential to the listed
 * hosts, so Claude Code honors it only from user settings, managed settings and
 * the `--settings` CLI flag; a `mask` entry in a repository's
 * `.claude/settings.json` is ignored outright. Keeping it would read as though
 * the credential were masked while nothing protects it — the one project-scope
 * gap whose consequence is a live credential leaving the sandbox unmasked.
 *
 * Filtered per entry rather than per key, because the same lists carry `deny`
 * entries that project settings *do* honor. `mode` is matched exactly: an entry
 * Claude Code cannot read as `mask` is not treated as one either (it degrades
 * such entries to `deny`), so the "reads as masked but isn't" state this guards
 * against cannot slip through a differently-spelled value.
 *
 * Like `stripSandboxPaths`, only the override copy is filtered — a
 * value already in the target file is left untouched, which is why the warning
 * points at it.
 *
 * @see https://code.claude.com/docs/en/sandboxing — "`mask` entries … are all
 *   ignored in a repository's `.claude/settings.json` or
 *   `.claude/settings.local.json`"; the file-entry section states the same
 *   settings-source restriction applies there.
 */
function stripProjectIgnoredMaskEntries({
  sandbox,
  relativeFilePath,
  logger,
}: {
  sandbox: Record<string, unknown>;
  relativeFilePath: string;
  logger?: Logger;
}): Record<string, unknown> {
  const credentials = sandbox.credentials;
  if (!isPlainRecord(credentials)) return sandbox;

  const filteredCredentials: Record<string, unknown> = { ...credentials };
  let changed = false;
  for (const listKey of CLAUDECODE_MASKABLE_CREDENTIAL_LISTS) {
    const list = filteredCredentials[listKey];
    if (!Array.isArray(list)) continue;
    const kept = list.filter((entry) => !(isPlainRecord(entry) && entry.mode === "mask"));
    if (kept.length === list.length) continue;
    changed = true;
    const dropped = list.length - kept.length;
    logger?.warn(
      `Claude Code permissions: 'sandbox.credentials.${listKey}' entries with 'mode: "mask"' are only honored in user/managed/--settings settings, so ${dropped} of them ${dropped === 1 ? "was" : "were"} not written to the project-scoped ${relativeFilePath}. Author them in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
    );
    if (kept.length === 0) {
      delete filteredCredentials[listKey];
    } else {
      filteredCredentials[listKey] = kept;
    }
  }
  if (!changed) return sandbox;

  const filtered = { ...sandbox };
  if (Object.keys(filteredCredentials).length === 0) {
    delete filtered.credentials;
  } else {
    filtered.credentials = filteredCredentials;
  }
  return filtered;
}

/**
 * Top-level `.claude/settings.json` keys another feature owns, derived from
 * {@link SHARED_CONFIG_OWNERSHIP} rather than restated here so a feature that
 * starts owning a new key is excluded from the passthrough automatically
 * (today: `hooks`, from the hooks feature). Only `replace-owned-keys` entries
 * name keys; the `custom` policies on this file (`ignore`, `permissions`) own
 * entries *inside* `permissions`, which the passthrough excludes wholesale.
 */
const CLAUDECODE_FEATURE_OWNED_SETTINGS_KEYS: readonly string[] = Object.entries(
  SHARED_CONFIG_OWNERSHIP[CLAUDE_SETTINGS_SHARED_FILE_KEY]?.features ?? {},
).flatMap(([feature, policy]) =>
  feature !== "permissions" && policy.kind === "replace-owned-keys" ? policy.ownedKeys : [],
);

/**
 * Top-level `.claude/settings.json` keys the generic `claudecode` override
 * passthrough must not carry. `permissions` and `sandbox` have their own merge
 * branches (the managed `allow`/`ask`/`deny` arrays and the scope filtering
 * respectively), `permission` is rulesync's own canonical tool-scoped block
 * rather than a settings key, `$schema` is an editor pointer rather than a
 * Claude Code setting, and the rest belong to the other features writing this
 * shared file.
 */
const CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS: ReadonlySet<string> = new Set([
  "permission",
  "permissions",
  "sandbox",
  "$schema",
  ...CLAUDECODE_FEATURE_OWNED_SETTINGS_KEYS,
]);

/**
 * Top-level settings keys Claude Code reads only from user settings, managed
 * settings and the `--settings` CLI flag — the same restriction
 * `CLAUDECODE_GLOBAL_ONLY_SANDBOX_PATHS` records for the `sandbox` subtree, and
 * the reason the passthrough drops them at project scope instead of committing
 * a setting that never applies. `rulesync generate --global` writes the user
 * settings file, so they are emitted there.
 *
 * Derived from the per-key **Scope** column of the settings reference: every
 * top-level key documented as `User or managed` or `User, local, or managed`.
 *
 * @see https://code.claude.com/docs/en/settings-reference
 */
const CLAUDECODE_USER_SCOPE_ONLY_KEYS: ReadonlySet<string> = new Set([
  "askUserQuestionTimeout",
  "autoMode",
  "dialogExpiry",
  "enableArtifact",
  "footerLinksRegexes",
  "pluginConfigs",
  "skipAutoPermissionPrompt",
  "skipDangerousModePermissionPrompt",
  "spellcheck",
  "sshConfigs",
  "syncClaudeAiSkills",
  "useAutoModeDuringPlan",
  "vimInsertModeRemaps",
]);

/**
 * Top-level settings keys neither file rulesync writes can honor, with the file
 * that does. `Managed` keys are read only from the settings file an organization
 * deploys, and `Global config` keys only from `~/.claude.json` — rulesync writes
 * `.claude/settings.json` and `~/.claude/settings.json`, so authoring either
 * kind through the override would produce a policy that silently never applies.
 *
 * Derived from the per-key **Scope** column of the settings reference.
 *
 * @see https://code.claude.com/docs/en/settings-reference
 */
const CLAUDECODE_UNHONORED_KEY_SOURCES: Readonly<Record<string, string>> = {
  allowAllClaudeAiMcps: "managed settings",
  allowedChannelPlugins: "managed settings",
  allowManagedHooksOnly: "managed settings",
  allowManagedMcpServersOnly: "managed settings",
  allowManagedPermissionRulesOnly: "managed settings",
  autoConnectIde: "~/.claude.json",
  autoInstallIdeExtension: "~/.claude.json",
  blockedMarketplaces: "managed settings",
  browserExternalPageTools: "managed settings",
  channelsEnabled: "managed settings",
  claudeMd: "managed settings",
  diffTool: "~/.claude.json",
  disableBrowserExternalNavigation: "managed settings",
  disableCommandPluginSources: "managed settings",
  disableMobileSimulatorTools: "managed settings",
  disableSideloadFlags: "managed settings",
  externalEditorContext: "~/.claude.json",
  forceLoginGatewayUrl: "managed settings",
  forceRemoteSettingsRefresh: "managed settings",
  parentSettingsBehavior: "managed settings",
  permissionExplainerEnabled: "~/.claude.json",
  pluginSuggestionMarketplaces: "managed settings",
  pluginTrustMessage: "managed settings",
  requiredMaximumVersion: "managed settings",
  requiredMinimumVersion: "managed settings",
  sshHostAllowlist: "managed settings",
  strictKnownMarketplaces: "managed settings",
  strictPluginOnlyCustomization: "managed settings",
  teammateDefaultModel: "~/.claude.json",
  wslInheritsWindowsSettings: "managed settings",
};

/**
 * Top-level settings keys whose value Claude Code **executes**. The generic
 * passthrough refuses them outright rather than warning: `.rulesync/*` files
 * are shareable — `rulesync fetch` copies a third party's `permissions.jsonc`
 * straight into a project — and a file named for *restricting* what an agent
 * may do is not somewhere a reviewer looks for a command to run. Commands
 * belong in `.rulesync/hooks.jsonc` and `.rulesync/.mcp.json`, which are read
 * as executable by anyone reviewing them. Set these by hand in the settings
 * file if you need them.
 *
 * The value is the reason, spliced into the warning.
 *
 * @see https://code.claude.com/docs/en/settings-reference
 */
const CLAUDECODE_COMMAND_EXECUTING_KEYS: Readonly<Record<string, string>> = {
  apiKeyHelper: "runs the script it names to mint an API key",
  awsAuthRefresh: "runs the command it names to refresh AWS credentials",
  awsCredentialExport: "runs the command it names to export AWS credentials",
  fileSuggestion: "runs its `command` on every `@` file completion",
  gcpAuthRefresh: "runs the command it names to refresh Google Cloud credentials",
  otelHeadersHelper: "runs the script it names to build OpenTelemetry headers",
  policyHelper: "runs the executable it names to compute the managed settings",
  processWrapper: "wraps every process Claude Code spawns",
  statusLine: "runs its `command` on every status-line render",
  subagentStatusLine: "runs its `command` on every subagent status row",
};

/**
 * Top-level settings keys the passthrough does write, but never silently: each
 * one widens what Claude Code trusts or where it sends data, so a value that
 * arrived with a fetched `.rulesync/permissions.jsonc` should be looked at
 * deliberately. Warning on write follows the precedent set for Warp's
 * `command_denylist`, which also replaces a protection when rulesync writes it.
 *
 * The value is the reason, spliced into the warning.
 */
const CLAUDECODE_TRUST_AFFECTING_KEYS: Readonly<Record<string, string>> = {
  // Every value of these keys is worth a line in the log, so unlike the
  // `sandbox` table they carry no predicate — except for the handful in
  // `CLAUDECODE_TRUST_KEY_WIDENING_VALUES` below, whose loosening value is the
  // absence of a restriction rather than the presence of a permission.
  agent: "starts every session as the named subagent, with that subagent's prompt, tools and model",
  allowedHttpHookUrls:
    "limits which URLs an HTTP hook may target, and an empty list means every URL",
  allowedMcpServers:
    "allowlists the MCP servers that may be used, and entries from every settings file merge into one list, so an entry here widens an allowlist deployed elsewhere",
  autoMode: "auto-approves shell commands with a classifier rather than with a prompt",
  claudeMdExcludes:
    "skips the CLAUDE.md files its patterns match, so the instructions a repository relies on can be dropped from every session",
  companyAnnouncements:
    "prints the strings it names at startup as your organization's announcement, so a fetched value speaks to the reader with your organization's voice",
  crossSessionInbound:
    "decides what a session does with messages arriving from your other Claude Code sessions, and `accept` delivers them straight to Claude",
  disableAllHooks: "controls whether hooks run at all",
  disableSkillShellExecution:
    "re-opens the inline shell commands in a skill or custom command that a user setting had turned off",
  enableAllProjectMcpServers: "auto-approves every server in the project `.mcp.json`",
  enabledMcpjsonServers: "auto-approves the named servers in the project `.mcp.json`",
  enabledPlugins: "enables plugins, which can ship their own hooks",
  env: "sets environment variables for every process Claude Code spawns, so a value such as `NODE_OPTIONS` or `PATH` runs code and `ANTHROPIC_BASE_URL` redirects every prompt",
  extraKnownMarketplaces: "registers plugin marketplace sources",
  httpHookAllowedEnvVars:
    "controls which environment variables an HTTP hook may put in a request header, credentials included",
  modelOverrides:
    "maps the model IDs it names to provider IDs, so an entry decides which endpoint every prompt for that model reaches",
  outputStyle: "replaces the system prompt every session runs with",
  prUrlTemplate:
    "rewrites the pull-request links Claude Code renders, so they can point at a host of the template's choosing rather than at the reviewed PR",
  remoteControlAtStartup:
    "connects Remote Control automatically at session start, and the transcript of a connected session is stored on Anthropic servers to sync it across devices",
  skipAutoPermissionPrompt: "removes the confirmation shown before auto-approval mode starts",
  skipDangerousModePermissionPrompt:
    "removes the confirmation shown before the mode that skips every permission check starts",
  skipWebFetchPreflight:
    "turns off the WebFetch domain safety check, so WebFetch retrieves any URL without consulting Anthropic's blocklist",
};

/**
 * The predicates {@link CLAUDECODE_TRUST_KEY_WIDENING_VALUES} is built from.
 * Each names the value that does *not* widen and reports everything else, never
 * the reverse: the override is authored JSONC, so a key can carry any value at
 * all, and one Claude Code coerces is still honored. Reporting an off-type value
 * keeps the warning fail-safe — silence has to mean "this cannot loosen
 * anything", not "this is not the type the table expected".
 */
const isNotFalse = (value: unknown): boolean => value !== false;
const isNotTrue = (value: unknown): boolean => value !== true;
const isNonEmptyList = (value: unknown): boolean => !Array.isArray(value) || value.length > 0;
const isNonEmptyMap = (value: unknown): boolean =>
  !isPlainRecord(value) || Object.keys(value).length > 0;

/**
 * The keys from the table above that only widen at one particular value.
 * `disableSkillShellExecution: true` turns inline shell execution off, which
 * restricts; anything else re-opens it, and that is what a fetched override
 * could use to undo a user setting. The rest default to off, so only a value
 * other than the one that leaves them off is worth a line — and for the
 * list-valued and map-valued keys, only a non-empty one, since an empty list or
 * map excludes, announces and overrides nothing.
 */
const CLAUDECODE_TRUST_KEY_WIDENING_VALUES: Readonly<Record<string, (value: unknown) => boolean>> =
  {
    claudeMdExcludes: isNonEmptyList,
    companyAnnouncements: isNonEmptyList,
    // Only `accept` delivers the message to Claude; `hold` and `refuse` are the
    // two restrictive rungs of the documented `accept` < `hold` < `refuse`
    // ladder, and an unset key leaves Claude Code deciding per message.
    crossSessionInbound: (value) => value !== "hold" && value !== "refuse",
    disableSkillShellExecution: isNotTrue,
    modelOverrides: isNonEmptyMap,
    remoteControlAtStartup: isNotFalse,
    skipWebFetchPreflight: isNotFalse,
  };

/**
 * Top-level keys a project-scoped `.claude/settings.json` honors at one value
 * but ignores at another — the value-level counterpart of
 * {@link CLAUDECODE_USER_SCOPE_ONLY_KEYS}, which is scoped per key. The ignored
 * value is dropped at project scope for the same reason a wholly unhonored key
 * is: committing it would read as a policy that never applies.
 *
 * `remoteControlAtStartup` is the only entry whose honored value can be decided
 * from the value alone. Claude Code honors a `false` from project or local
 * settings — a repository may turn auto-connect off for its own checkout — but
 * ignores a `true`, so that a checked-in file cannot turn Remote Control on for
 * everyone who opens the repository.
 *
 * `crossSessionInbound` is on the same documented list but deliberately absent
 * here: it is a ladder (`accept` < `hold` < `refuse`) whose project value is
 * honored only when it is stricter than the one above it, which no per-value
 * predicate can decide without reading the user's own settings. It is warned
 * about through {@link CLAUDECODE_TRUST_AFFECTING_KEYS} instead, since under
 * `--global` its loosening value is honored outright.
 *
 * @see https://code.claude.com/docs/en/settings#security-keys-where-the-stricter-value-applies
 */
const CLAUDECODE_PROJECT_SCOPE_IGNORED_VALUES: Readonly<
  Record<string, { readonly ignored: (value: unknown) => boolean; readonly note: string }>
> = {
  remoteControlAtStartup: {
    // The same predicate the widening table uses, shared rather than repeated:
    // both ask "is this something other than the restrictive `false`?", so they
    // must not be able to drift apart.
    ignored: isNotFalse,
    note: "Claude Code honors only a `false` there, so that a checked-in file cannot turn Remote Control on for everyone who opens the repository",
  },
};

/**
 * A key name is authored data that ends up in a log line, so strip the control
 * characters that would let it forge a line or hide the warnings beside it, and
 * cap the length.
 */
function displayKey(key: string): string {
  const stripped = stripControlCharacters(key);
  return stripped.length > 80 ? `${stripped.slice(0, 80)}…` : stripped;
}

/**
 * Alternate spellings Claude Code accepts for a top-level settings key, mapped
 * to the canonical key whose **Scope** the alias inherits: "In any settings
 * file that accepts the canonical key, Claude Code reads the alias exactly as
 * it reads the canonical key." Resolving through this map before the scope
 * check keeps an alias from slipping past a restriction its canonical spelling
 * is caught by — `allowedMarketplaces` is `Managed`, like
 * `strictKnownMarketplaces`. Both aliases require Claude Code v2.1.232+.
 *
 * @see https://code.claude.com/docs/en/settings-reference#marketplace-key-aliases
 */
const CLAUDECODE_SETTINGS_KEY_ALIASES: Readonly<Record<string, string>> = {
  additionalMarketplaces: "extraKnownMarketplaces",
  allowedMarketplaces: "strictKnownMarketplaces",
};

/**
 * Copy of the authored top-level passthrough with the keys the target file
 * cannot honor removed, warning once per dropped key. Like
 * `stripSandboxPaths`, only the override copy is filtered — a value
 * already hand-written in the target file is left untouched, which is why the
 * warning points at it.
 */
function stripUnhonoredTopLevelKeys({
  overrides,
  global,
  relativeFilePath,
  logger,
}: {
  overrides: Record<string, unknown>;
  global: boolean;
  relativeFilePath: string;
  logger?: Logger;
}): { filtered: Record<string, unknown>; trustAffecting: TrustAffectingEntry[] } {
  const filtered: Record<string, unknown> = {};
  const trustAffecting: TrustAffectingEntry[] = [];
  for (const [key, value] of Object.entries(overrides)) {
    const shown = displayKey(key);
    // An alias is honored wherever its canonical spelling is, so the scope
    // check runs against the canonical key rather than the authored one.
    const canonicalKey = Object.hasOwn(CLAUDECODE_SETTINGS_KEY_ALIASES, key)
      ? (CLAUDECODE_SETTINGS_KEY_ALIASES[key] as string)
      : key;
    if (Object.hasOwn(CLAUDECODE_COMMAND_EXECUTING_KEYS, canonicalKey)) {
      logger?.warn(
        `Claude Code permissions: '${shown}' ${CLAUDECODE_COMMAND_EXECUTING_KEYS[canonicalKey]}, so rulesync does not write it to ${relativeFilePath}. A permissions file is shareable — 'rulesync fetch' copies one into a project — and is not where a reviewer looks for a command to run; author commands in .rulesync/hooks.jsonc, or set this key in ${relativeFilePath} by hand.`,
      );
      continue;
    }
    if (Object.hasOwn(CLAUDECODE_UNHONORED_KEY_SOURCES, canonicalKey)) {
      logger?.warn(
        `Claude Code permissions: '${shown}' is only honored in ${CLAUDECODE_UNHONORED_KEY_SOURCES[canonicalKey]}, which rulesync does not generate, so it is not written to ${relativeFilePath}. Set it in that file by hand, and check ${relativeFilePath} for a stale value an earlier generate may have left there.`,
      );
      continue;
    }
    if (!global && CLAUDECODE_USER_SCOPE_ONLY_KEYS.has(canonicalKey)) {
      logger?.warn(
        `Claude Code permissions: '${shown}' is not honored in the project-scoped ${relativeFilePath}, so it is not written there — Claude Code reads it from user, local or managed settings. Author it in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
      );
      continue;
    }
    const projectIgnored = Object.hasOwn(CLAUDECODE_PROJECT_SCOPE_IGNORED_VALUES, canonicalKey)
      ? CLAUDECODE_PROJECT_SCOPE_IGNORED_VALUES[canonicalKey]
      : undefined;
    if (!global && projectIgnored !== undefined && projectIgnored.ignored(value)) {
      logger?.warn(
        `Claude Code permissions: this value of '${shown}' is not honored in the project-scoped ${relativeFilePath}, so it is not written there — ${projectIgnored.note}. Author it in the global scope instead, and check that file for a stale value an earlier generate may have left there.`,
      );
      continue;
    }
    // Guarded rather than indexed directly, so the lookup is safe on its own
    // terms instead of relying on the `CLAUDECODE_TRUST_AFFECTING_KEYS` check
    // below happening to run first.
    const widensAtValue = Object.hasOwn(CLAUDECODE_TRUST_KEY_WIDENING_VALUES, canonicalKey)
      ? CLAUDECODE_TRUST_KEY_WIDENING_VALUES[canonicalKey]
      : undefined;
    if (
      Object.hasOwn(CLAUDECODE_TRUST_AFFECTING_KEYS, canonicalKey) &&
      (widensAtValue === undefined || widensAtValue(value))
    ) {
      trustAffecting.push({
        label: shown,
        reason: CLAUDECODE_TRUST_AFFECTING_KEYS[canonicalKey] as string,
      });
    }
    filtered[key] = value;
  }
  return { filtered, trustAffecting };
}

const CLAUDE_PATH_RULE_ALIASES: Record<string, string> = {
  Write: "Edit",
  NotebookEdit: "Edit",
  Glob: "Read",
};

/**
 * Build a Claude Code permission entry like "Bash(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildClaudePermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${CLAUDE_PATH_RULE_ALIASES[toolName] ?? toolName}(${pattern})`;
}

/**
 * The Claude tool names the canonical config manages. Deliberately the tool
 * names the categories map to and *not* the aliases a path rule is rewritten
 * to: claiming `Edit` because a `write` rule exists would sweep away the
 * `Read`/`Edit` entries the ignore feature and the user wrote in the same file.
 * The rewritten entries are still rulesync's to place — `applyPermissions`
 * replaces an entry this run emits wherever it currently sits — and the
 * original name stays claimed so an entry an older rulesync wrote in the warned
 * form is cleaned up on the next generate.
 */
function managedClaudeToolNames(config: PermissionsConfig): Set<string> {
  return new Set(Object.keys(config.permission).map((category) => toClaudeToolName(category)));
}

export class ClaudecodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: CLAUDECODE_DIR,
      relativeFilePath: CLAUDECODE_SETTINGS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new ClaudecodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToClaudePermissions({ config, logger });

    // Every setting below that widens what Claude Code trusts lands here and is
    // reported in one line at the end, so a file that sets a dozen of them does
    // not bury the reasons in a dozen copies of the same advice.
    const trustAffecting: TrustAffectingEntry[] = [];

    // Merge the Claude Code-scoped override's non-list `permissions` fields
    // (e.g. `defaultMode`, `additionalDirectories`) into the settings
    // `permissions` object. The managed `allow`/`ask`/`deny` arrays are excluded
    // — rulesync owns them and `applyPermissions` sets them below.
    const overridePermissions = config.claudecode?.permissions;
    if (overridePermissions && typeof overridePermissions === "object") {
      const { allow: _a, ask: _k, deny: _d, ...rest } = overridePermissions;
      const nonListFields = Object.fromEntries(
        Object.entries(rest).filter(([key]) => !PROTOTYPE_POLLUTION_KEYS.has(key)),
      );
      trustAffecting.push(...collectWideningPermissionFields({ fields: nonListFields }));
      settings.permissions = { ...settings.permissions, ...nonListFields };
    }

    // `sandbox` sits next to `permissions` at the top level of settings.json.
    // Deep-merged rather than shallow: its subtrees hold deny lists
    // (`network.deniedDomains`, `filesystem.denyRead`), so replacing `network`
    // wholesale to set one flag would drop the restrictions beside it.
    const overrideSandbox = config.claudecode?.sandbox;
    if (isPlainRecord(overrideSandbox)) {
      // A subset of `sandbox.*` is ignored in a repository's settings.json, so
      // at project scope those paths are dropped rather than committed as a
      // policy that never applies.
      const honorableSandbox = stripSandboxPaths({
        sandbox: overrideSandbox,
        refusals: global
          ? [CLAUDECODE_COMMAND_EXECUTING_SANDBOX_REFUSAL, CLAUDECODE_MANAGED_ONLY_SANDBOX_REFUSAL]
          : [
              CLAUDECODE_COMMAND_EXECUTING_SANDBOX_REFUSAL,
              CLAUDECODE_MANAGED_ONLY_SANDBOX_REFUSAL,
              CLAUDECODE_GLOBAL_ONLY_SANDBOX_REFUSAL,
            ],
        relativeFilePath: paths.relativeFilePath,
        logger,
      });
      const scopedSandbox = global
        ? honorableSandbox
        : stripProjectIgnoredMaskEntries({
            sandbox: honorableSandbox,
            relativeFilePath: paths.relativeFilePath,
            logger,
          });
      // Collected from the filtered result so the summary never names a path
      // the scope filters just dropped.
      trustAffecting.push(...collectTrustAffectingSandboxPaths({ sandbox: scopedSandbox }));
      if (Object.keys(scopedSandbox).length > 0) {
        settings.sandbox = deepMergeRecords(
          isPlainRecord(settings.sandbox) ? settings.sandbox : {},
          scopedSandbox,
        );
      }
    }

    // Everything else in the override is a plain top-level settings key, written
    // through generically rather than key by key. Claude Code adds these faster
    // than an allowlist can track (2.1.217-2.1.239 alone added
    // `emojiCompletionEnabled`, `workflowSizeGuideline`, `spellcheck`,
    // `keybindingFlavor` and the `additionalMarketplaces`/`allowedMarketplaces`
    // aliases), and an unmodeled key used to validate and then vanish with no
    // warning. Deep-merged for the same reason `sandbox` is: a nested key the
    // author sets must not replace the siblings already in the file.
    const overrideTopLevel: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(config.claudecode ?? {})) {
      if (CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS.has(key)) continue;
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (value === undefined) continue;
      overrideTopLevel[key] = value;
    }
    const { filtered: scopedTopLevel, trustAffecting: trustAffectingTopLevel } =
      stripUnhonoredTopLevelKeys({
        overrides: overrideTopLevel,
        global,
        relativeFilePath: paths.relativeFilePath,
        logger,
      });
    trustAffecting.push(...trustAffectingTopLevel);
    if (Object.keys(scopedTopLevel).length > 0) {
      settings = deepMergeRecords(
        settings as Record<string, unknown>,
        scopedTopLevel,
      ) as ClaudeSettingsJson;
    }

    warnOnTrustAffectingEntries({
      entries: trustAffecting,
      relativeFilePath: paths.relativeFilePath,
      logger,
    });

    const managedToolNames = managedClaudeToolNames(config);

    // The gateway owns the shared `permissions` merge and the cross-feature
    // ownership rule; here we only state the intent (managed tools + arrays).
    const merged = applyPermissions({
      settings,
      managedToolNames,
      toolNameOf: (entry) => parseClaudePermissionEntry(entry).toolName,
      allow,
      ask,
      deny,
      logger,
    });
    const fileContent = JSON.stringify(merged, null, 2);

    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Claude permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertClaudeToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

    // Route the non-list `permissions` fields (defaultMode, additionalDirectories,
    // org locks, ...) into the claudecode override so they round-trip without
    // leaking into other tools' configs.
    const { allow: _a, ask: _k, deny: _d, ...permissionsRest } = permissions;
    const nonListFields = Object.fromEntries(
      Object.entries(permissionsRest).filter(([key]) => !PROTOTYPE_POLLUTION_KEYS.has(key)),
    );
    if (Object.keys(nonListFields).length > 0) {
      config.claudecode = { permissions: nonListFields };
    }

    // The sibling `sandbox` subtree round-trips through the same override block,
    // minus the paths that name an executable: symmetric with generate, which
    // refuses to write them, so the override never carries a value that only
    // ever produces a warning.
    const { sandbox } = settings;
    if (isPlainRecord(sandbox)) {
      const importedSandbox = structuredClone(sandbox);
      for (const path of CLAUDECODE_COMMAND_EXECUTING_SANDBOX_PATHS) {
        deleteSandboxPath({ target: importedSandbox, path });
      }
      if (Object.keys(importedSandbox).length > 0) {
        config.claudecode = { ...config.claudecode, sandbox: importedSandbox };
      }
    }

    // Every remaining top-level key round-trips through the same block, so an
    // imported `.claude/settings.json` survives the next generate instead of
    // being narrowed to the keys this feature happens to model. The keys other
    // features own are left to them: `hooks` is the hooks feature's, and
    // `permissions` is handled above.
    const topLevelPassthrough: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(settings as Record<string, unknown>)) {
      if (CLAUDECODE_NON_PASSTHROUGH_OVERRIDE_KEYS.has(key)) continue;
      // Symmetric with generate: a key generate refuses to write must not be
      // imported either, or the override would carry a value that only ever
      // produces a warning.
      const canonicalKey = Object.hasOwn(CLAUDECODE_SETTINGS_KEY_ALIASES, key)
        ? (CLAUDECODE_SETTINGS_KEY_ALIASES[key] as string)
        : key;
      if (Object.hasOwn(CLAUDECODE_COMMAND_EXECUTING_KEYS, canonicalKey)) continue;
      // `JSON.parse` makes `__proto__` an own property, so a settings file can
      // carry one into the override block; drop it here as well as on generate.
      if (PROTOTYPE_POLLUTION_KEYS.has(key)) continue;
      if (value === undefined) continue;
      topLevelPassthrough[key] = value;
    }
    if (Object.keys(topLevelPassthrough).length > 0) {
      config.claudecode = { ...config.claudecode, ...topLevelPassthrough };
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(config, null, 2),
    });
  }

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ClaudecodePermissions {
    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Claude Code allow/ask/deny arrays.
 */
function convertRulesyncToClaudePermissions({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];
  // Two categories can now produce the same entry — `write` and `edit` both map
  // to `Edit(path)` — so a disagreement between them becomes a config that says
  // two things at once. Claude Code resolves deny first, but the author should
  // hear about it rather than discover it later.
  const actionByEntry = new Map<string, PermissionAction>();

  for (const [category, rules] of Object.entries(config.permission)) {
    const claudeToolName = toClaudeToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildClaudePermissionEntry(claudeToolName, pattern);
      const previous = actionByEntry.get(entry);
      if (previous !== undefined && previous !== action) {
        logger?.warn(
          `Claude Code permissions: rules from different categories both resolve to "${entry}" ` +
            `with conflicting actions (${previous} and ${action}). Both are written; Claude Code ` +
            `applies deny first, then ask, then allow.`,
        );
      }
      actionByEntry.set(entry, action);
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

/**
 * Convert Claude Code allow/ask/deny arrays to rulesync permissions config.
 */
function convertClaudeToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseClaudePermissionEntry(entry);
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
