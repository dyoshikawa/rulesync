import { join } from "node:path";

import { JUNIE_DIR, JUNIE_PERMISSIONS_FILE_NAME } from "../../constants/junie-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionAction,
  PermissionActionSchema,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import type { Logger } from "../../utils/logger.js";
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
 * JetBrains Junie CLI Action Allowlist (`allowlist.json`).
 *
 * Junie gates actions through an allowlist evaluated top-to-bottom (first match
 * wins). The allowlist is **user-scope only**: Junie CLI resolves exactly one
 * path, `~/.junie/allowlist.json` (`AgentActionsWhitelistImpl` computes it from
 * `junieHome`; verified against release `2383.10` — no doc, CLI flag, or
 * `config.json` field names a project-scope allowlist), so this feature is
 * global-only, mirroring the Junie hooks surface.
 *
 * ```json
 * {
 *   "defaultBehavior": "ask",
 *   "allowReadonlyCommands": true,
 *   "rules": {
 *     "executables":        { "rules": [ { "prefix": "git ", "action": "allow" } ] },
 *     "fileEditing":        { "rules": [ { "pattern": "src/**", "action": "allow" } ] },
 *     "mcpTools":           { "rules": [ { "prefix": "search", "action": "allow" } ] },
 *     "readOutsideProject": { "rules": [ { "pattern": "/etc/**", "action": "ask" } ] },
 *     "readSecretFile":     { "rules": [ { "pattern": "**\/.env", "action": "ask" } ] }
 *   }
 * }
 * ```
 *
 * Every rule group is an `AllowListRuleSet` **object** (`{ "default"?: …,
 * "rules": [ … ] }`), never a bare array: Junie's `AllowListParser` (verified
 * against release `2383.10`) rejects the array form for the whole file, and
 * Junie then discards and overwrites `allowlist.json`. Earlier rulesync
 * versions emitted the array form; it is still tolerated on import so those
 * files read back, but only the object form is ever written.
 *
 * Each rule carries a literal `prefix` (matches commands that start with it) or
 * a glob `pattern` (`*`, `**`, `?`, `[abc]`, `[!abc]`) plus an `action`. Junie
 * documents only `allow` and `ask` as valid actions — there is **no `deny`**
 * (https://junie.jetbrains.com/docs/action-allowlist-junie-cli.html). rulesync's
 * canonical `allow`/`ask` map 1:1; a canonical `deny` has no Junie equivalent
 * and is mapped to the nearest valid action, `ask` (still withholds
 * auto-approval), with a warning so the downgrade is surfaced.
 *
 * Category mapping (rulesync canonical <-> Junie rule group):
 * - `bash`         <-> `executables`
 * - `edit`/`write` -> `fileEditing`  (imported back as `edit`)
 * - `read`         <-> `readOutsideProject`
 * - `mcp`          <-> `mcpTools`
 *
 * Categories Junie cannot represent (e.g. `webfetch`) are skipped on export
 * (with a warning when they carry rules). The top-level `defaultBehavior` and
 * `allowReadonlyCommands` settings have no canonical per-glob slot: they are
 * authored and round-tripped through the `junie` override namespace (see
 * `JuniePermissionsOverrideSchema`) — lifted into the override on import and
 * merged back onto the top level on export — and any other unmodeled top-level
 * key is preserved verbatim.
 *
 * @see https://junie.jetbrains.com/docs/action-allowlist-junie-cli.html
 */
const JUNIE_RULE_GROUPS = ["executables", "fileEditing", "mcpTools", "readOutsideProject"] as const;
type JunieRuleGroup = (typeof JUNIE_RULE_GROUPS)[number];

/**
 * `readSecretFile` is the fifth group of Junie's `AllowListRules` (release
 * `2383.10`; absent from the public docs page). It has no canonical category —
 * `read` is already taken by `readOutsideProject` — so it is authored whole
 * through the `junie` override rather than mapped.
 */
const JUNIE_SECRET_FILE_GROUP = "readSecretFile";

type JunieAllowlistAction = "allow" | "ask";

type JunieRule = {
  prefix?: string;
  pattern?: string;
  action: JunieAllowlistAction;
};

/** Junie's `AllowListRuleSet`: a per-group fallback plus its rules. */
type JunieRuleSet = {
  default?: JunieAllowlistAction;
  rules?: JunieRule[];
};

type JunieAllowlist = {
  // Junie's `AllowListDecision` accepts only `allow`/`ask` (enforced by the
  // `junie` override schema on authoring); kept as a bare string here so a
  // hand-written file with another value still parses for inspection.
  defaultBehavior?: string;
  allowReadonlyCommands?: boolean;
  // Object form is what Junie parses; the bare-array form is what earlier
  // rulesync versions wrote and is tolerated on read only.
  rules?: Record<string, JunieRuleSet | JunieRule[]>;
  [key: string]: unknown;
};

/** Normalize a rule group read from disk: legacy bare array → `{ rules }`. */
function toRuleSet(value: JunieRuleSet | JunieRule[] | undefined): JunieRuleSet | undefined {
  if (value === undefined) {
    return undefined;
  }
  if (Array.isArray(value)) {
    return { rules: value };
  }
  return typeof value === "object" && value !== null ? value : undefined;
}

/** Only `allow`/`ask` exist in Junie's `AllowListDecision` (release `2383.10`). */
function toAllowlistAction(value: unknown): JunieAllowlistAction | undefined {
  return value === "allow" || value === "ask" ? value : undefined;
}

/**
 * Sanitize a rule set read from disk into the shape both Junie's parser and
 * the `junie` override schema accept — a hand-written file may carry anything.
 * An entry without a `prefix`/`pattern` is dropped; an entry with an invalid
 * action (e.g. a hand-written `deny`, which fails Junie's whole-file parse) is
 * kept with `ask`, the restrictive action nearest the author's intent, rather
 * than being dropped — these sets restrict what Junie may do, so losing an
 * entry would fail open. Used on both the import lift (so the canonical file
 * always validates, keeping later generates working) and the generate-side
 * preservation (so rulesync never writes back a value Junie would reject and
 * destroy the file over).
 */
function sanitizeRuleSet(set: JunieRuleSet): JunieRuleSet {
  const rules = (Array.isArray(set.rules) ? set.rules : []).flatMap((rule): JunieRule[] => {
    if (!rule || typeof rule !== "object") {
      return [];
    }
    const prefix = typeof rule.prefix === "string" ? rule.prefix : undefined;
    const pattern = typeof rule.pattern === "string" ? rule.pattern : undefined;
    if (prefix === undefined && pattern === undefined) {
      return [];
    }
    return [
      {
        ...(prefix !== undefined && { prefix }),
        ...(pattern !== undefined && { pattern }),
        action: toAllowlistAction(rule.action) ?? "ask",
      },
    ];
  });
  const setDefault = toAllowlistAction(set.default);
  return { ...(setDefault !== undefined && { default: setDefault }), rules };
}

const CANONICAL_TO_JUNIE_GROUP: Record<string, JunieRuleGroup> = {
  bash: "executables",
  edit: "fileEditing",
  write: "fileEditing",
  read: "readOutsideProject",
  mcp: "mcpTools",
};

const JUNIE_GROUP_TO_CANONICAL: Record<JunieRuleGroup, string> = {
  executables: "bash",
  fileEditing: "edit",
  mcpTools: "mcp",
  readOutsideProject: "read",
};

function isPermissionAction(value: unknown): value is PermissionAction {
  return PermissionActionSchema.safeParse(value).success;
}

/**
 * Whether a rulesync pattern uses glob syntax. Junie expresses literal
 * "starts-with" matches as `prefix` and glob matches as `pattern`, so a pattern
 * containing any glob metacharacter (`*`, `?`, `[`) is emitted as `pattern`.
 */
function isGlobPattern(pattern: string): boolean {
  return /[*?[]/.test(pattern);
}

export class JuniePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    // allowlist.json may carry user-managed top-level settings
    // (defaultBehavior / allowReadonlyCommands) that rulesync does not model,
    // so the permissions feature must never delete it.
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    // Global-only: `~/.junie/allowlist.json` (the home directory is resolved
    // by the processor through outputRoot).
    return {
      relativeDirPath: JUNIE_DIR,
      relativeFilePath: JUNIE_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<JuniePermissions> {
    const paths = JuniePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? "{}";
    return new JuniePermissions({
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
    logger,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<JuniePermissions> {
    const paths = JuniePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let existing: JunieAllowlist;
    try {
      const parsed: unknown = JSON.parse(existingContent);
      existing =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as JunieAllowlist)
          : {};
    } catch (error) {
      throw new Error(
        `Failed to parse existing Junie allowlist at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();

    // The `junie` override authors the top-level autonomy knobs
    // (allowReadonlyCommands, defaultBehavior) plus the group-shaped settings
    // handled below (readSecretFile, ruleDefaults). Overlay the scalar knobs
    // (the override wins), then rulesync owns the `rules` object; every other
    // existing top-level key is preserved verbatim. Nothing is fabricated, so
    // a fresh generate does not leak a spurious `junie` override on re-import.
    const override = config.junie;
    const {
      permission: _overridePermission,
      readSecretFile: overrideSecretFile,
      ruleDefaults: overrideRuleDefaults,
      ...topLevelOverrides
    } = (override !== undefined && typeof override === "object" ? override : {}) as {
      permission?: unknown;
      readSecretFile?: JunieRuleSet;
      ruleDefaults?: Partial<Record<JunieRuleGroup, JunieAllowlistAction>>;
      [key: string]: unknown;
    };

    const existingRules =
      existing.rules && typeof existing.rules === "object" && !Array.isArray(existing.rules)
        ? existing.rules
        : {};
    const rules = convertRulesyncToJunieRules({
      config,
      logger,
      existingRules,
      overrideSecretFile,
      overrideRuleDefaults,
    });

    const merged: JunieAllowlist = {
      ...existing,
      ...topLevelOverrides,
      rules,
    };

    return new JuniePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let allowlist: JunieAllowlist;
    try {
      const parsed: unknown = JSON.parse(this.getFileContent());
      allowlist =
        parsed && typeof parsed === "object" && !Array.isArray(parsed)
          ? (parsed as JunieAllowlist)
          : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Junie permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const { config, ruleDefaults, readSecretFile } = convertJunieToRulesyncPermissions({
      allowlist,
    });

    // Lift Junie's top-level autonomy knobs and group-shaped settings into the
    // `junie` override so they are authorable and portable instead of only
    // round-trip-preserved.
    const junieOverride: Record<string, unknown> = {};
    if (typeof allowlist.allowReadonlyCommands === "boolean") {
      junieOverride.allowReadonlyCommands = allowlist.allowReadonlyCommands;
    }
    // Junie's AllowListDecision accepts only allow/ask (a stray value fails
    // the whole-file parse on Junie's side); lift only what the override
    // schema can hold — an invalid value stays untouched in the target file.
    if (allowlist.defaultBehavior === "allow" || allowlist.defaultBehavior === "ask") {
      junieOverride.defaultBehavior = allowlist.defaultBehavior;
    }
    if (Object.keys(ruleDefaults).length > 0) {
      junieOverride.ruleDefaults = ruleDefaults;
    }
    if (readSecretFile !== undefined) {
      junieOverride.readSecretFile = readSecretFile;
    }

    const result: Record<string, unknown> = { ...config };
    if (Object.keys(junieOverride).length > 0) {
      result.junie = junieOverride;
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
  }: ToolPermissionsForDeletionParams): JuniePermissions {
    // Kept for interface parity; isDeletable() returns false so the file is
    // never actually removed by the permissions feature.
    return new JuniePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: "{}",
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config into Junie's `rules` object, where every
 * group is an `AllowListRuleSet` object (`{ default?, rules }`) — the only
 * shape Junie's parser accepts. Categories with no Junie rule group (e.g.
 * `webfetch`) are skipped, with a warning when they carry any rule so the gap
 * is surfaced.
 *
 * Per-group `default` comes from the `junie` override's `ruleDefaults`, or —
 * when not authored there — is preserved from the existing file. The
 * `readSecretFile` group is likewise authored whole via the override or
 * preserved from the existing file: it restricts what Junie may read, so a
 * generate must never silently wipe it.
 */
function convertRulesyncToJunieRules({
  config,
  logger,
  existingRules,
  overrideSecretFile,
  overrideRuleDefaults,
}: {
  config: PermissionsConfig;
  logger?: Logger;
  existingRules: Record<string, JunieRuleSet | JunieRule[]>;
  overrideSecretFile?: JunieRuleSet;
  overrideRuleDefaults?: Partial<Record<JunieRuleGroup, JunieAllowlistAction>>;
}): Record<string, JunieRuleSet> {
  const ruleLists: Partial<Record<JunieRuleGroup, JunieRule[]>> = {};

  for (const [category, patterns] of Object.entries(honorAllToolsOnBash(config.permission))) {
    const group = CANONICAL_TO_JUNIE_GROUP[category];
    if (!group) {
      if (Object.keys(patterns).length > 0) {
        logger?.warn(
          `Junie allowlist only models executables/fileEditing/mcpTools/readOutsideProject ` +
            `(canonical bash/edit/write/read/mcp); '${category}' rules cannot be represented and ` +
            `were skipped.`,
        );
      }
      continue;
    }

    for (const [pattern, action] of Object.entries(patterns)) {
      const junieAction = toJunieAction(action, category, pattern, logger);
      const rule: JunieRule = isGlobPattern(pattern)
        ? { pattern, action: junieAction }
        : { prefix: pattern, action: junieAction };
      (ruleLists[group] ??= []).push(rule);
    }
  }

  const rules: Record<string, JunieRuleSet> = {};
  for (const group of JUNIE_RULE_GROUPS) {
    const list = ruleLists[group];
    // A hand-written existing default outside allow/ask would fail Junie's
    // whole-file parse if written back, so only a valid one is preserved.
    const groupDefault =
      overrideRuleDefaults?.[group] ?? toAllowlistAction(toRuleSet(existingRules[group])?.default);
    if (list === undefined && groupDefault === undefined) {
      continue;
    }
    rules[group] = {
      ...(groupDefault !== undefined && { default: groupDefault }),
      rules: list ?? [],
    };
  }

  const secretFile = overrideSecretFile ?? toRuleSet(existingRules[JUNIE_SECRET_FILE_GROUP]);
  if (secretFile !== undefined) {
    rules[JUNIE_SECRET_FILE_GROUP] = sanitizeRuleSet(secretFile);
  }

  return rules;
}

/**
 * Map a canonical action onto a valid Junie allowlist action. Junie supports
 * only `allow` and `ask`; a canonical `deny` is downgraded to `ask` (the
 * nearest valid action — both withhold auto-approval) with a warning, so
 * rulesync never emits a `deny` that Junie would silently ignore.
 */
function toJunieAction(
  action: PermissionAction,
  category: string,
  pattern: string,
  logger?: Logger,
): "allow" | "ask" {
  if (action === "deny") {
    logger?.warn(
      `Junie's allowlist supports only 'allow'/'ask' actions; the '${category}' deny rule ` +
        `for '${pattern}' was downgraded to 'ask' (Junie has no 'deny').`,
    );
    return "ask";
  }
  return action;
}

/**
 * Convert a Junie allowlist back into rulesync permissions config plus the
 * group-shaped `junie` override fields. Each group may be Junie's object form
 * (`{ default?, rules }`) or the legacy bare array earlier rulesync versions
 * wrote; both are read. Per-group defaults come back as `ruleDefaults` and the
 * `readSecretFile` group comes back whole, so they survive the round-trip.
 */
function convertJunieToRulesyncPermissions({ allowlist }: { allowlist: JunieAllowlist }): {
  config: PermissionsConfig;
  ruleDefaults: Partial<Record<JunieRuleGroup, JunieAllowlistAction>>;
  readSecretFile?: JunieRuleSet;
} {
  const permission: PermissionsConfig["permission"] = {};
  const ruleDefaults: Partial<Record<JunieRuleGroup, JunieAllowlistAction>> = {};
  let readSecretFile: JunieRuleSet | undefined;
  const rules =
    allowlist.rules && typeof allowlist.rules === "object" && !Array.isArray(allowlist.rules)
      ? allowlist.rules
      : {};

  for (const group of JUNIE_RULE_GROUPS) {
    const ruleSet = toRuleSet(rules[group]);
    if (ruleSet === undefined) {
      continue;
    }
    if (ruleSet.default === "allow" || ruleSet.default === "ask") {
      ruleDefaults[group] = ruleSet.default;
    }
    const category = JUNIE_GROUP_TO_CANONICAL[group];
    for (const rule of Array.isArray(ruleSet.rules) ? ruleSet.rules : []) {
      if (!rule || typeof rule !== "object") {
        continue;
      }
      const pattern =
        typeof rule.pattern === "string"
          ? rule.pattern
          : typeof rule.prefix === "string"
            ? rule.prefix
            : undefined;
      if (pattern === undefined || !isPermissionAction(rule.action)) {
        continue;
      }
      (permission[category] ??= {})[pattern] = rule.action;
    }
  }

  // Sanitized so the lifted value always satisfies the `junie` override
  // schema: an unvalidated lift would write a canonical permissions file that
  // fails validation on every later generate.
  const secretFileSet = toRuleSet(rules[JUNIE_SECRET_FILE_GROUP]);
  if (secretFileSet !== undefined) {
    readSecretFile = sanitizeRuleSet(secretFileSet);
  }

  return { config: { permission }, ruleDefaults, readSecretFile };
}
