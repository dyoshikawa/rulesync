import { join } from "node:path";

import { uniq } from "es-toolkit";
import * as smolToml from "smol-toml";

import {
  REASONIX_GLOBAL_DIR,
  REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
  REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
} from "../../constants/reasonix-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import {
  toReasonixStringArray as toStringArray,
  toReasonixTable as toPermissionsTable,
} from "../shared/reasonix-config-table.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectTrustAffectingSandboxPaths,
  isNonEmptyList,
  isNotFalse,
  type TrustAffectingEntry,
  type TrustAffectingSandboxPath,
  warnOnTrustAffectingEntries,
} from "./sandbox-trust.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Reasonix
 * permission-rule tool families (PascalCase).
 *
 * Reasonix's `[permissions]` rule syntax (SPEC.md §3.7) is explicitly
 * documented as "Claude Code-style": "Bash and file mutation approvals use
 * Claude Code-style families such as `Bash(npm run build)`, `Bash(npm run
 * test:*)`, and `Edit(docs/**)`." Reasonix also accepts legacy lowercase tool
 * IDs for compatibility, but new rules are saved using these PascalCase
 * families, so rulesync reuses the same mapping `claudecode-permissions.ts`
 * uses (the closest documented precedent for this syntax).
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
 */
const CANONICAL_TO_REASONIX_TOOL_NAMES: Record<string, string> = {
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
 * Reverse mapping from Reasonix tool names to rulesync canonical names.
 */
const REASONIX_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_REASONIX_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toReasonixToolName(canonical: string): string {
  return CANONICAL_TO_REASONIX_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(reasonixName: string): string {
  return REASONIX_TO_CANONICAL_TOOL_NAMES[reasonixName] ?? reasonixName;
}

/**
 * Whether an entry uses the first-class `Tool=<literal>` exact-command form
 * (SPEC §3.7, v1.18.0): metacharacters in the literal are ordinary characters
 * and only the identical complete command matches. These entries have no
 * canonical tool→pattern→action equivalent — glob-style `Tool(...)` matches
 * differently by design — so they are preserved verbatim and round-trip
 * through the `reasonix` override's rawAllow/rawAsk/rawDeny arrays.
 */
function isReasonixExactCommandEntry(entry: string): boolean {
  const eqIndex = entry.indexOf("=");
  if (eqIndex <= 0) {
    return false;
  }
  const parenIndex = entry.indexOf("(");
  return parenIndex === -1 || eqIndex < parenIndex;
}

/**
 * Parse a Reasonix permission entry like "Bash(npm run *)" into tool name and pattern.
 * If no parentheses, returns the tool name with "*" as the pattern.
 */
function parseReasonixPermissionEntry(entry: string): { toolName: string; pattern: string } {
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
 * Build a Reasonix permission entry like "Bash(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildReasonixPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

type ReasonixConfig = Record<string, unknown>;

type ReasonixPermissionsTable = Record<string, unknown> & {
  mode?: string;
  allow?: string[];
  ask?: string[];
  deny?: string[];
};

/** The `[permissions]` key the override's `allowDynamicBash` writes and reads. */
const REASONIX_ALLOW_DYNAMIC_BASH_KEY = "allow_dynamic_bash";

/**
 * `[sandbox]` keys whose authored value loosens the enforcement layer beneath
 * the permission policy: they take Bash out of its OS jail, open that jail to
 * the network, or widen where the file-writing built-ins may write. Written —
 * the ordinary uses are far too common to refuse — but never silently, the same
 * stance `DEVIN_TRUST_AFFECTING_SANDBOX_PATHS` takes, and `widens` likewise
 * names the restrictive value so a spelling Reasonix does not recognize is
 * reported rather than waved through.
 *
 * `forbid_read` and `workspace_root` are not here. `forbid_read` restricts, so
 * it loosens by losing entries rather than by holding one, which needs the
 * before/after comparison this table cannot express; `workspace_root` moves the
 * write confinement rather than widening it, and an ordinary project root would
 * be reported on every generate.
 *
 * @see https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
 */
const REASONIX_TRUST_AFFECTING_SANDBOX_PATHS: readonly TrustAffectingSandboxPath[] = [
  {
    path: ["bash"],
    reason:
      "anything but 'enforce' takes Bash out of the OS sandbox, so a command may write and read " +
      "wherever the user can",
    widens: (value) => value !== "enforce",
  },
  {
    path: ["network"],
    reason: "lets sandboxed Bash reach the network",
    widens: isNotFalse,
  },
  {
    path: ["allow_write"],
    reason:
      "adds directories the file-writing tools may modify outside the workspace root, which a " +
      "headless run would otherwise refuse",
    widens: isNonEmptyList,
  },
];

/**
 * Writes the override's `allow_dynamic_bash` into `[permissions]`, where it sits
 * beside allow/ask/deny rather than in a table of its own, and reports it when
 * it is being turned on: it widens what a shareable permissions file lets run
 * with no human in the loop. Only an authored value is written — leaving the key
 * out of the override keeps whatever the file already had — and turning it off
 * narrows, so that stays quiet. The entries are returned rather than logged so
 * one generate still produces one warning naming everything it wrote.
 */
function applyAllowDynamicBash({
  permissions,
  authored,
}: {
  permissions: ReasonixPermissionsTable;
  authored: boolean | undefined;
}): TrustAffectingEntry[] {
  if (authored === undefined) return [];
  permissions[REASONIX_ALLOW_DYNAMIC_BASH_KEY] = authored;
  if (!isNotFalse(authored)) return [];
  return [
    {
      label: `permissions.${REASONIX_ALLOW_DYNAMIC_BASH_KEY}`,
      reason:
        "lets an Allow fallback, Auto included, run the nested and indirect Bash that " +
        "otherwise needs a human or an exact-literal grant — command and process substitution, " +
        "a dynamic command name, 'eval', 'source', 'sh -c' and their kind",
    },
  ];
}

function parseReasonixConfig(fileContent: string): ReasonixConfig {
  const parsed = smolToml.parse(fileContent || smolToml.stringify({}));
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) {
    return {};
  }
  return { ...(parsed as Record<string, unknown>) };
}

// The `[agent]` sub-keys the `reasonix` override authors and round-trips. The
// whole `[sandbox]` table is a dedicated security surface, so it round-trips in
// full; `[agent]` also holds unrelated settings, so only the plan-mode keys are
// extracted on import.
// `plan_mode_read_only_commands` survives upstream, though labelled "legacy
// compatibility only; Plan bash now uses Permissions", so it stays authorable.
// https://github.com/esengine/DeepSeek-Reasonix/blob/main-v2/docs/SPEC.md
const REASONIX_OVERRIDE_AGENT_KEYS = ["plan_mode_read_only_commands"] as const;

/**
 * `[agent]` keys an older `reasonix.toml` may carry that left the documented
 * config surface in v1.17.18 — plan-mode tool access is the permissions layer's
 * job now. Still lifted on import, so the value stays visible in the
 * tool-scoped `reasonix` override rather than vanishing, but stripped before
 * anything is written: authoring a key Reasonix ignores helps nobody.
 */
const REASONIX_RETIRED_AGENT_KEYS = ["plan_mode_allowed_tools"] as const;

function asReasonixRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === "object" && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : {};
}

function pickReasonixKeys(source: unknown, keys: readonly string[]): Record<string, unknown> {
  const record = asReasonixRecord(source);
  const picked: Record<string, unknown> = {};
  for (const key of keys) {
    if (record[key] !== undefined) picked[key] = record[key];
  }
  return picked;
}

export class ReasonixPermissions extends ToolPermissions {
  private readonly toml: ReasonixConfig;

  constructor(params: AiFileParams) {
    super(params);
    this.toml = parseReasonixConfig(this.getFileContent());
  }

  override isDeletable(): boolean {
    // The Reasonix config file may hold many other settings (providers, ui,
    // agent, MCP `[[plugins]]`, …), so it must never be deleted when no
    // rulesync-managed permission rules remain.
    return false;
  }

  static getSettablePaths({ global }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Project config lives at the repository root (`./reasonix.toml`), while the
    // global config lives at `~/.reasonix/config.toml`; the home root is supplied
    // by the processor via outputRoot. Same file the MCP adapter reads/writes.
    if (global) {
      return {
        relativeDirPath: REASONIX_GLOBAL_DIR,
        relativeFilePath: REASONIX_GLOBAL_PERMISSIONS_FILE_NAME,
      };
    }
    return {
      relativeDirPath: ".",
      relativeFilePath: REASONIX_PROJECT_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<ReasonixPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    return new ReasonixPermissions({
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
    validate = true,
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ReasonixPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const relativeFilePathForLog = toPosixPath(join(paths.relativeDirPath, paths.relativeFilePath));
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    const parsed = parseReasonixConfig(existingContent);

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToReasonixPermissions(config);

    // Determine which tool names are managed by the permissions config
    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toReasonixToolName(category)),
    );

    // The override's raw arrays are merged verbatim below — the authoring path
    // for exact `Bash=<literal>` rules (and any other entry syntax rulesync
    // does not translate). An entry named in ANY raw array is owned by the
    // override, so its on-disk copies in the other arrays are dropped: moving
    // an entry from rawAllow to rawDeny must not leave a stale allow beside
    // the intended deny.
    const override = config.reasonix;
    const rawAllow = toStringArray(override?.rawAllow);
    const rawAsk = toStringArray(override?.rawAsk);
    const rawDeny = toStringArray(override?.rawDeny);
    const rawOwnedEntries = new Set([...rawAllow, ...rawAsk, ...rawDeny]);

    const existingPermissions = toPermissionsTable(parsed.permissions);
    const {
      allow: preservedAllow,
      ask: preservedAsk,
      deny: preservedDeny,
    } = preserveExistingEntries({ existingPermissions, managedToolNames, rawOwnedEntries, logger });

    // Warn when permissions feature overwrites ignore-generated Read(...) deny entries
    if (logger && managedToolNames.has("Read")) {
      const droppedReadDenyEntries = toStringArray(existingPermissions.deny).filter((entry) => {
        const { toolName } = parseReasonixPermissionEntry(entry);
        return toolName === "Read";
      });
      if (droppedReadDenyEntries.length > 0) {
        logger.warn(
          `Permissions feature manages 'Read' tool and will overwrite ${droppedReadDenyEntries.length} existing Read deny entries (possibly from ignore feature). Permissions take precedence.`,
        );
      }
    }

    // `mode` (the writer fallback: ask|allow|deny) has no equivalent in
    // rulesync's canonical permissions model, so any existing value is
    // preserved untouched via this spread rather than being managed here.
    const mergedPermissions: ReasonixPermissionsTable = { ...existingPermissions };

    setOrDeleteEntries(mergedPermissions, "allow", [...preservedAllow, ...allow, ...rawAllow]);
    setOrDeleteEntries(mergedPermissions, "ask", [...preservedAsk, ...ask, ...rawAsk]);
    setOrDeleteEntries(mergedPermissions, "deny", [...preservedDeny, ...deny, ...rawDeny]);

    // Collected rather than logged as they are found: one generate writes one
    // warning naming everything trust-affecting it put in the file.
    const trustAffecting: TrustAffectingEntry[] = applyAllowDynamicBash({
      permissions: mergedPermissions,
      authored: override?.allowDynamicBash,
    });

    const patch: Record<string, unknown> = { permissions: mergedPermissions };

    // Overlay the Reasonix-scoped override's `[sandbox]`/`[agent]` tables. Shallow
    // merged at the table's top level, so the override's keys win while unrelated
    // sibling keys the user set directly (e.g. `[agent].model`) are preserved.
    if (override?.sandbox !== undefined) {
      const authoredSandbox = asReasonixRecord(override.sandbox);
      patch.sandbox = {
        ...asReasonixRecord(parsed.sandbox),
        ...authoredSandbox,
      };
      // The authored table rather than the merged one: a loosening value the
      // file already held is the user's own, and re-announcing it on every
      // generate would bury the values rulesync actually wrote.
      trustAffecting.push(
        ...collectTrustAffectingSandboxPaths({
          sandbox: authoredSandbox,
          paths: REASONIX_TRUST_AFFECTING_SANDBOX_PATHS,
        }),
      );
    }
    if (override?.agent !== undefined) {
      const mergedAgent = {
        ...asReasonixRecord(parsed.agent),
        ...asReasonixRecord(override.agent),
      };
      // Strip from the merged table, not just from what was authored: dropping
      // only the authored value would leave a wider list already in the file
      // untouched, so narrowing one would be the single edit that never lands.
      const retired = REASONIX_RETIRED_AGENT_KEYS.filter((key) => mergedAgent[key] !== undefined);
      for (const key of retired) {
        delete mergedAgent[key];
      }
      if (retired.length > 0) {
        logger?.warn(
          `Reasonix permissions: removing ${retired.map((key) => `"${key}"`).join(", ")} from ` +
            `[agent] in ${relativeFilePathForLog}; Reasonix took the key off its config surface in v1.17.18, ` +
            `so what it used to express now belongs in the shared \`permission\` block.`,
        );
      }
      patch.agent = mergedAgent;
    }

    warnOnTrustAffectingEntries({
      toolLabel: "Reasonix",
      entries: trustAffecting,
      relativeFilePath: relativeFilePathForLog,
      logger,
    });

    return new ReasonixPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch,
        filePath,
      }),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const permissions = toPermissionsTable(this.toml.permissions);

    // Exact `Tool=<literal>` entries are lifted verbatim into the override's
    // raw arrays: parsed as tool(pattern) they would mint a bogus category key
    // like `"Bash=go test ./..."` in the shared block.
    const splitExact = (entries: string[]): { translated: string[]; exact: string[] } => {
      const exact = entries.filter((entry) => isReasonixExactCommandEntry(entry));
      const translated = entries.filter((entry) => !isReasonixExactCommandEntry(entry));
      return { translated, exact };
    };
    const allowSplit = splitExact(toStringArray(permissions.allow));
    const askSplit = splitExact(toStringArray(permissions.ask));
    const denySplit = splitExact(toStringArray(permissions.deny));

    const config = convertReasonixToRulesyncPermissions({
      allow: allowSplit.translated,
      ask: askSplit.translated,
      deny: denySplit.translated,
    });

    // Route Reasonix's security tables into the `reasonix` override — they have
    // no canonical category. The `[sandbox]` table is dedicated, so it
    // round-trips in full; only the plan-mode keys are lifted from
    // `[agent]` (which also carries unrelated settings). Note the merge is
    // shallow on generate but the extract is whole-table for `[sandbox]`, so an
    // existing `[sandbox]` key the override did not author is pulled into the
    // override on the next import.
    const sandbox = asReasonixRecord(this.toml.sandbox);
    const agentPlanMode = pickReasonixKeys(this.toml.agent, [
      ...REASONIX_OVERRIDE_AGENT_KEYS,
      ...REASONIX_RETIRED_AGENT_KEYS,
    ]);
    const reasonixOverride: Record<string, unknown> = {};
    // `[permissions] allow_dynamic_bash` is lifted only when it is the boolean
    // Reasonix documents: any other shape is left in the table the generate
    // preserves, rather than round-tripped through a typed override field that
    // would have to reshape it.
    const allowDynamicBash = permissions[REASONIX_ALLOW_DYNAMIC_BASH_KEY];
    if (typeof allowDynamicBash === "boolean") {
      reasonixOverride.allowDynamicBash = allowDynamicBash;
    }
    if (Object.keys(sandbox).length > 0) reasonixOverride.sandbox = sandbox;
    if (Object.keys(agentPlanMode).length > 0) reasonixOverride.agent = agentPlanMode;
    if (allowSplit.exact.length > 0) reasonixOverride.rawAllow = allowSplit.exact;
    if (askSplit.exact.length > 0) reasonixOverride.rawAsk = askSplit.exact;
    if (denySplit.exact.length > 0) reasonixOverride.rawDeny = denySplit.exact;

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(reasonixOverride).length > 0) {
      result.reasonix = reasonixOverride;
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify(result, null, 2),
    });
  }

  validate(): ValidationResult {
    try {
      parseReasonixConfig(this.getFileContent());
      return { success: true, error: null };
    } catch (error) {
      return {
        success: false,
        error: new Error(`Failed to parse Reasonix config TOML: ${formatError(error)}`),
      };
    }
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): ReasonixPermissions {
    return new ReasonixPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
    });
  }
}

/**
 * Preserve existing permission entries rulesync does not manage: entries for
 * tools NOT in the permissions config, plus exact `Tool=<literal>` entries not
 * owned by the override's raw arrays — Reasonix writes those itself as
 * remembered approvals, and dropping them would revoke grants the canonical
 * glob rules cannot re-express. Remove one by deleting it from `reasonix.toml`
 * (or by naming it in a raw array, which takes ownership). Preserved exact
 * entries are logged so the kept-alive grants stay visible.
 */
function preserveExistingEntries({
  existingPermissions,
  managedToolNames,
  rawOwnedEntries,
  logger,
}: {
  existingPermissions: ReasonixPermissionsTable;
  managedToolNames: Set<string>;
  rawOwnedEntries: Set<string>;
  logger?: Logger;
}): { allow: string[]; ask: string[]; deny: string[] } {
  const isPreserved = (entry: string): boolean => {
    if (isReasonixExactCommandEntry(entry)) {
      return !rawOwnedEntries.has(entry);
    }
    return !managedToolNames.has(parseReasonixPermissionEntry(entry).toolName);
  };
  const allow = toStringArray(existingPermissions.allow).filter(isPreserved);
  const ask = toStringArray(existingPermissions.ask).filter(isPreserved);
  const deny = toStringArray(existingPermissions.deny).filter(isPreserved);

  const preservedExact = [...allow, ...ask, ...deny].filter((entry) =>
    isReasonixExactCommandEntry(entry),
  );
  if (preservedExact.length > 0) {
    logger?.info(
      `Preserving ${preservedExact.length} exact Reasonix permission entries ` +
        `(remembered approvals): ${preservedExact.join(", ")}`,
    );
  }

  return { allow, ask, deny };
}

/** Sort, dedupe and set a permissions array key, deleting it when empty. */
function setOrDeleteEntries(
  table: ReasonixPermissionsTable,
  key: "allow" | "ask" | "deny",
  entries: string[],
): void {
  const merged = uniq(entries.toSorted());
  if (merged.length > 0) {
    table[key] = merged;
  } else {
    delete table[key];
  }
}

/**
 * Convert rulesync permissions config to Reasonix allow/ask/deny arrays.
 */
function convertRulesyncToReasonixPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const reasonixToolName = toReasonixToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildReasonixPermissionEntry(reasonixToolName, pattern);
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
 * Convert Reasonix allow/ask/deny arrays to rulesync permissions config.
 */
function convertReasonixToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseReasonixPermissionEntry(entry);
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
