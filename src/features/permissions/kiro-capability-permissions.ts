import { join } from "node:path";
import { isDeepStrictEqual } from "node:util";

import { dump } from "js-yaml";

import { KIRO_PERMISSIONS_FILE_NAME, KIRO_SETTINGS_DIR_PATH } from "../../constants/kiro-paths.js";
import type { AiFileParams } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import { loadYaml } from "../../utils/yaml.js";
import { KiroPermissions } from "./kiro-permissions.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import { honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const CATCH_ALL_PATTERN = "*";

// Canonical category -> Kiro capability. `grep`/`glob` are left out on purpose:
// Kiro has no search-only capability, and folding them into `fs_read` would turn
// a narrow search allow into a general read allow.
const CANONICAL_TO_KIRO_CAPABILITY: Record<string, KiroCapability> = {
  bash: "shell",
  read: "fs_read",
  edit: "fs_write",
  write: "fs_write",
  webfetch: "web_fetch",
  websearch: "web_search",
};

// Kiro capability -> canonical category, for import. `fs_write` imports as
// `write` (the canonical `edit` category folds into the same capability).
const KIRO_CAPABILITY_TO_CANONICAL: Record<KiroCapability, string> = {
  shell: "bash",
  fs_read: "read",
  fs_write: "write",
  web_fetch: "webfetch",
  web_search: "websearch",
};

type KiroCapability = "shell" | "fs_read" | "fs_write" | "web_fetch" | "web_search";

const MANAGED_CAPABILITIES = new Set<string>(Object.keys(KIRO_CAPABILITY_TO_CANONICAL));

const ACTION_RANK: Record<PermissionAction, number> = { allow: 0, ask: 1, deny: 2 };

type KiroCapabilityRule = {
  capability: KiroCapability;
  match?: string[];
  effect: PermissionAction;
};

function isPermissionAction(value: unknown): value is PermissionAction {
  return value === "allow" || value === "ask" || value === "deny";
}

/**
 * Whether an existing `permissions.yaml` rule can be read back into the
 * canonical model: a rule for a capability rulesync maps, with no `exclude`
 * list (the canonical model has no exclusion). Used on import only.
 */
function isImportableRule(rule: unknown): boolean {
  return (
    isRecord(rule) &&
    typeof rule.capability === "string" &&
    MANAGED_CAPABILITIES.has(rule.capability) &&
    rule.exclude === undefined
  );
}

/**
 * Key identifying one (capability, pattern) pair. The catch-all `*` stands for
 * a match-less rule.
 */
function rulePatternKey(capability: string, pattern: string): string {
  return `${capability}\u0000${pattern}`;
}

type ExistingEntryOutcome = "duplicate" | "conflict" | "unrelated";

/**
 * Classify one existing (capability, pattern, effect) entry against the
 * generated rules: an exact duplicate (same effect) is replaced by the
 * generated rule; a different effect is a conflict and is kept; anything
 * rulesync does not emit is unrelated and kept.
 */
function classifyExistingEntry({
  emitted,
  capability,
  pattern,
  effect,
}: {
  emitted: Map<string, Set<PermissionAction>>;
  capability: string;
  pattern: string;
  effect: unknown;
}): ExistingEntryOutcome {
  const effects = emitted.get(rulePatternKey(capability, pattern));
  if (effects === undefined) return "unrelated";
  return isPermissionAction(effect) && effects.has(effect) ? "duplicate" : "conflict";
}

/**
 * Merge one existing rule against the generated entries (see
 * {@link mergeKiroCapabilityRules}). Returns the rule to keep (possibly with a
 * narrowed `match`), or `undefined` when every entry is an exact duplicate, and
 * how many entries rulesync does not generate.
 */
function mergeExistingRule({
  rule,
  emitted,
  logger,
}: {
  rule: unknown;
  emitted: Map<string, Set<PermissionAction>>;
  logger?: Logger;
}): { rule: unknown; unrelatedEntries: number } {
  if (
    !isRecord(rule) ||
    typeof rule.capability !== "string" ||
    rule.exclude !== undefined ||
    !MANAGED_CAPABILITIES.has(rule.capability) ||
    (rule.match !== undefined && !isStringArray(rule.match))
  ) {
    return { rule, unrelatedEntries: 0 };
  }
  const capability = rule.capability;
  const isCatchAll = rule.match === undefined;
  const patterns = isStringArray(rule.match) ? rule.match : [CATCH_ALL_PATTERN];
  // An empty `match` is not a rule rulesync writes; keep it verbatim.
  if (patterns.length === 0) return { rule, unrelatedEntries: 0 };
  const remaining: string[] = [];
  let unrelatedEntries = 0;
  for (const pattern of patterns) {
    const outcome = classifyExistingEntry({ emitted, capability, pattern, effect: rule.effect });
    if (outcome === "duplicate") continue;
    remaining.push(pattern);
    if (outcome === "unrelated") {
      unrelatedEntries++;
      continue;
    }
    logger?.warn(
      `Kiro permissions.yaml already has a ${capability} rule for "${pattern}" with effect "${String(rule.effect)}"; keeping it alongside the generated rule. Kiro applies the stricter effect (deny > ask > allow).`,
    );
  }
  if (remaining.length === 0) return { rule: undefined, unrelatedEntries };
  if (remaining.length === patterns.length || isCatchAll) return { rule, unrelatedEntries };
  return { rule: { ...rule, match: remaining }, unrelatedEntries };
}

/**
 * Merge the existing rules with the generated ones. Rulesync keeps no
 * ownership record in the file, so it only removes what it is about to write
 * again: an existing rule loses the `match` entries that exactly duplicate a
 * generated (capability, pattern, effect) — a match-less rule counts as the `*`
 * pattern — and is dropped only when no entry is left.
 *
 * Everything else is kept verbatim: rules Kiro saved ("Always allow/deny"),
 * hand-written rules, rules with `exclude`, rules for capabilities rulesync
 * does not map, malformed entries. An existing rule with the same pattern but a
 * different effect is kept too, with a warning: Kiro resolves deny > ask >
 * allow, so the stricter rule still wins and a user's `deny` is never loosened.
 * Rerunning generate is therefore idempotent.
 */
function mergeKiroCapabilityRules({
  existingRules,
  generatedRules,
  logger,
}: {
  existingRules: unknown[];
  generatedRules: KiroCapabilityRule[];
  logger?: Logger;
}): unknown[] {
  const emitted = new Map<string, Set<PermissionAction>>();
  for (const rule of generatedRules) {
    for (const pattern of rule.match ?? [CATCH_ALL_PATTERN]) {
      const key = rulePatternKey(rule.capability, pattern);
      const effects = emitted.get(key) ?? new Set<PermissionAction>();
      effects.add(rule.effect);
      emitted.set(key, effects);
    }
  }

  const kept: unknown[] = [];
  let unrelatedManagedEntries = 0;
  for (const rule of existingRules) {
    const result = mergeExistingRule({ rule, emitted, logger });
    if (result.rule !== undefined) kept.push(result.rule);
    unrelatedManagedEntries += result.unrelatedEntries;
  }

  if (unrelatedManagedEntries > 0) {
    logger?.warn(
      `Kiro permissions.yaml keeps ${unrelatedManagedEntries} existing shell/fs_read/fs_write/web_fetch/web_search rule ${unrelatedManagedEntries === 1 ? "entry" : "entries"} that .rulesync/permissions.json does not generate. Rulesync never removes rules from this file and cannot tell which of these it wrote earlier; delete any stale ones by hand.`,
    );
  }
  return [...kept, ...generatedRules];
}

// Filesystem patterns that name a location independent of the workspace:
// absolute POSIX or Windows drive paths, home-relative paths, or a leading `**`.
const LOCATION_INDEPENDENT_FS_PATTERN = /^(?:\/|~|\*\*|[A-Za-z]:[\\/])/;

/**
 * Permissions adapter for Kiro's capability-based `permissions.yaml` (Kiro IDE
 * 1.0, and the same engine in Kiro CLI V3). Used for the `kiro-cli` and
 * `kiro-ide` targets in **global** scope, where it writes the user-level
 * `~/.kiro/settings/permissions.yaml`. Project scope keeps writing the agent
 * config `.kiro/agents/default.json` through {@link KiroPermissions}: the
 * workspace-level `permissions.yaml` lives under a hash-derived directory in the
 * home directory, not in the repository, so it cannot be generated.
 *
 * Mapping (rulesync canonical -> Kiro rule):
 *   - Category -> `capability`: `bash` -> `shell`, `read` -> `fs_read`,
 *     `edit`/`write` -> `fs_write`, `webfetch` -> `web_fetch`, `websearch` ->
 *     `web_search`. Other categories are skipped with a warning.
 *   - Action -> `effect` 1:1, including `ask`.
 *   - Pattern -> `match` entry. The catch-all `*` becomes a rule with no `match`
 *     (the whole capability), because a filesystem `*` only matches one path
 *     component in Kiro.
 *
 * Kiro also writes into this file (consent decisions persisted globally), so it
 * is merged, never replaced or deleted: every top-level key other than `rules`
 * is preserved, and existing rules are kept except for entries that exactly
 * repeat a generated rule (see {@link mergeKiroCapabilityRules}). Rulesync
 * never retracts a rule an earlier run wrote; it warns instead. A run that
 * changes nothing returns the existing content verbatim; otherwise the file is
 * re-serialized and its YAML comments are lost.
 *
 * @see https://kiro.dev/docs/permissions/
 */
export class KiroCapabilityPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({ ...params, fileContent: params.fileContent ?? "" });
  }

  override shouldSkipCreationWhenPayloadEmpty(): boolean {
    return true;
  }

  static getSettablePaths(_options?: { global?: boolean }): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: KIRO_SETTINGS_DIR_PATH,
      relativeFilePath: KIRO_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<KiroCapabilityPermissions> {
    const paths = this.getSettablePaths({ global: true });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "";
    return new KiroCapabilityPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global: true,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<KiroCapabilityPermissions> {
    const paths = this.getSettablePaths({ global: true });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";

    let parsed: unknown;
    try {
      parsed = loadYaml(existingContent) ?? {};
    } catch (error) {
      throw new Error(
        `Failed to parse existing Kiro permissions.yaml at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }
    if (!isRecord(parsed)) {
      throw new Error(`Failed to parse existing Kiro permissions.yaml at ${filePath}: not a map`);
    }
    if (parsed.rules !== undefined && !Array.isArray(parsed.rules)) {
      throw new Error(
        `Failed to parse existing Kiro permissions.yaml at ${filePath}: 'rules' is not a list`,
      );
    }

    const config = rulesyncPermissions.getJson();
    if (config.kiro?.toolsSettings !== undefined) {
      logger?.warn(
        "Kiro permissions: 'kiro.toolsSettings' applies only to the project-scope agent config (.kiro/agents/default.json); ignoring it for ~/.kiro/settings/permissions.yaml.",
      );
    }

    const generatedRules = buildKiroCapabilityRules({ config, logger });
    const rules = mergeKiroCapabilityRules({
      existingRules: parsed.rules ?? [],
      generatedRules,
      logger,
    });

    const next: Record<string, unknown> = { ...parsed };
    if (rules.length > 0 || parsed.rules !== undefined) {
      next.rules = rules;
    }

    return new KiroCapabilityPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: serializeKiroPermissions({ next, parsed, existingContent }),
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: unknown;
    try {
      parsed = loadYaml(this.getFileContent()) ?? {};
    } catch (error) {
      throw new Error(
        `Failed to parse Kiro permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const rules = isRecord(parsed) && Array.isArray(parsed.rules) ? parsed.rules : [];
    const permission: PermissionsConfig["permission"] = {};
    for (const rule of rules) {
      if (!isImportableRule(rule) || !isRecord(rule) || !isPermissionAction(rule.effect)) continue;
      const category = KIRO_CAPABILITY_TO_CANONICAL[rule.capability as KiroCapability];
      const patterns =
        rule.match === undefined
          ? [CATCH_ALL_PATTERN]
          : isStringArray(rule.match)
            ? rule.match
            : [];
      const categoryRules = (permission[category] ??= {});
      for (const pattern of patterns) {
        const previous = categoryRules[pattern];
        // Kiro resolves overlapping rules deny > ask > allow; keep the stricter.
        if (previous === undefined || ACTION_RANK[rule.effect] > ACTION_RANK[previous]) {
          categoryRules[pattern] = rule.effect;
        }
      }
    }

    return this.toRulesyncPermissionsDefault({
      fileContent: JSON.stringify({ permission }, null, 2),
    });
  }

  static forDeletion({
    outputRoot = process.cwd(),
    relativeDirPath,
    relativeFilePath,
  }: ToolPermissionsForDeletionParams): KiroCapabilityPermissions {
    return new KiroCapabilityPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "",
      validate: false,
      global: true,
    });
  }
}

/**
 * Convert the canonical `permission` block into Kiro capability rules: one rule
 * per (capability, effect) carrying every non-catch-all pattern as `match`, plus
 * a match-less rule when the catch-all `*` is set.
 */
function buildKiroCapabilityRules({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: Logger;
}): KiroCapabilityRule[] {
  const buckets = new Map<
    string,
    { capability: KiroCapability; effect: PermissionAction; patterns: Set<string> }
  >();
  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    const capability = CANONICAL_TO_KIRO_CAPABILITY[category];
    if (capability === undefined) {
      logger?.warn(`Kiro permissions.yaml has no capability for category: ${category}. Skipping.`);
      continue;
    }
    for (const [pattern, effect] of Object.entries(rules)) {
      warnOnWorkspaceRelativeFsPattern({ capability, category, pattern, logger });
      const key = `${capability}\u0000${effect}`;
      const bucket = buckets.get(key) ?? { capability, effect, patterns: new Set<string>() };
      bucket.patterns.add(pattern);
      buckets.set(key, bucket);
    }
  }

  const result: KiroCapabilityRule[] = [];
  for (const { capability, effect, patterns } of buckets.values()) {
    if (patterns.has(CATCH_ALL_PATTERN)) {
      result.push({ capability, effect });
    }
    const match = [...patterns].filter((pattern) => pattern !== CATCH_ALL_PATTERN);
    if (match.length > 0) {
      result.push({ capability, match, effect });
    }
  }
  return result;
}

/**
 * Serialize the merged config. When the merge changes nothing, the existing
 * content is returned verbatim so a run with nothing to change never rewrites
 * the file (and never drops its YAML comments).
 */
function serializeKiroPermissions({
  next,
  parsed,
  existingContent,
}: {
  next: Record<string, unknown>;
  parsed: Record<string, unknown>;
  existingContent: string;
}): string {
  if (isDeepStrictEqual(next, parsed)) return existingContent;
  return Object.keys(next).length === 0 ? "" : dump(next);
}

/**
 * `~/.kiro/settings/permissions.yaml` applies to every workspace, so a relative
 * filesystem pattern such as `src/**` is not tied to the project it was written
 * for. Warn so the author can make it absolute, `~`-relative or `**`-prefixed.
 */
function warnOnWorkspaceRelativeFsPattern({
  capability,
  category,
  pattern,
  logger,
}: {
  capability: KiroCapability;
  category: string;
  pattern: string;
  logger?: Logger;
}): void {
  if (capability !== "fs_read" && capability !== "fs_write") return;
  if (pattern === CATCH_ALL_PATTERN || LOCATION_INDEPENDENT_FS_PATTERN.test(pattern)) return;
  logger?.warn(
    `Kiro permissions.yaml is user-level and applies to every workspace, but the ${category} pattern "${pattern}" is relative. Use an absolute, ~-relative or **-prefixed pattern to target a specific location.`,
  );
}

/**
 * Permissions factory for the `kiro-cli` / `kiro-ide` targets: project scope
 * writes the agent config `.kiro/agents/default.json` ({@link KiroPermissions}),
 * global scope writes `~/.kiro/settings/permissions.yaml`
 * ({@link KiroCapabilityPermissions}). The deprecated `kiro` alias stays on
 * {@link KiroPermissions} only.
 */
export const KiroScopedPermissions = {
  getSettablePaths(options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return options.global
      ? KiroCapabilityPermissions.getSettablePaths(options)
      : KiroPermissions.getSettablePaths(options);
  },
  fromFile(params: ToolPermissionsFromFileParams): Promise<ToolPermissions> {
    return params.global
      ? KiroCapabilityPermissions.fromFile(params)
      : KiroPermissions.fromFile(params);
  },
  fromRulesyncPermissions(
    params: ToolPermissionsFromRulesyncPermissionsParams,
  ): Promise<ToolPermissions> {
    return params.global
      ? KiroCapabilityPermissions.fromRulesyncPermissions(params)
      : KiroPermissions.fromRulesyncPermissions(params);
  },
  forDeletion(params: ToolPermissionsForDeletionParams): ToolPermissions {
    return params.global
      ? KiroCapabilityPermissions.forDeletion(params)
      : KiroPermissions.forDeletion(params);
  },
};
