import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  DEVIN_CONFIG_FILE_NAME,
  DEVIN_DIR,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
} from "../../constants/devin-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, toPosixPath } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  collectTrustAffectingSandboxPaths,
  findUnreadableContainer,
  isNonEmptyList,
  readSandboxPath,
  type TrustAffectingEntry,
  type TrustAffectingSandboxPath,
  UNREADABLE_SANDBOX_PATH,
  warnOnTrustAffectingEntries,
} from "./sandbox-trust.js";
import { honorAllToolsOnBash } from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names to Devin Local permission
 * scope matchers.
 *
 * Devin expresses permissions with scope-based matchers — `Read(glob)`,
 * `Write(glob)`, `Exec(prefix)`, and `Fetch(pattern)` — plus MCP tool patterns
 * (`mcp__server__tool`). The canonical `edit` and `write` categories both map
 * onto Devin's single `Write` scope; on import `Write` maps back to `write`, so
 * `edit` rules round-trip as `write` (a lossy but documented collapse). Unknown
 * names (e.g. `mcp__github__list_issues`) pass through verbatim.
 *
 * @see https://docs.devin.ai/cli/reference/permissions
 */
const CANONICAL_TO_DEVIN_SCOPE: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Write",
  bash: "Exec",
  webfetch: "Fetch",
};

/**
 * Reverse mapping from Devin scope matchers to rulesync canonical names.
 */
const DEVIN_SCOPE_TO_CANONICAL: Record<string, string> = {
  Read: "read",
  Write: "write",
  Exec: "bash",
  Fetch: "webfetch",
};

function toDevinScope(canonical: string): string {
  return CANONICAL_TO_DEVIN_SCOPE[canonical] ?? canonical;
}

function toCanonicalCategory(devinScope: string): string {
  return DEVIN_SCOPE_TO_CANONICAL[devinScope] ?? devinScope;
}

type DevinPermissionsBlock = {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  [key: string]: unknown;
};

/**
 * Parse a Devin permission entry like `Read(src/**)` into scope and pattern.
 * Bare entries (e.g. `Read`, or a whole-tool name like `exec`) yield `*`.
 */
function parseDevinPermissionEntry(entry: string): { scope: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { scope: entry, pattern: "*" };
  }
  const scope = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { scope, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { scope, pattern: pattern || "*" };
}

/**
 * Build a Devin permission entry like `Read(src/**)`. A `*` pattern collapses to
 * the bare scope (`Read`), matching the whole scope.
 */
function buildDevinPermissionEntry(scope: string, pattern: string): string {
  if (pattern === "*") {
    return scope;
  }
  return `${scope}(${pattern})`;
}

function asDevinRecord(value: unknown): Record<string, unknown> {
  return isRecord(value) ? { ...value } : {};
}

/**
 * `sandbox` paths whose authored value loosens the sandbox on its own: they let
 * a command out of it, or widen what a command left inside it may reach. They
 * are written — the ordinary uses are far too common to refuse — but never
 * silently, because a permissions file is shareable (`rulesync fetch` copies one
 * into a project) and should not be able to open the sandbox without saying so.
 * This is the same stance `CLAUDECODE_TRUST_AFFECTING_SANDBOX_PATHS` takes for
 * the equivalent Claude Code keys, and `widens` follows the same convention of
 * naming the restrictive value rather than the permissive ones, so a spelling
 * Devin does not recognize is reported rather than waved through.
 *
 * The three keys that restrict — `allowed_domains` (an allowlist only while it
 * has entries), `denied_domains` and `excluded.deny` — are not here: they loosen
 * by losing entries, which `DEVIN_RESTRICTION_LOSING_SANDBOX_PATHS` covers.
 *
 * @see https://docs.devin.ai/cli/sandbox
 */
const DEVIN_TRUST_AFFECTING_SANDBOX_PATHS: readonly TrustAffectingSandboxPath[] = [
  {
    path: ["network_mode"],
    reason:
      "anything but 'limited' lets sandboxed requests use every HTTP method, not just GET/HEAD/OPTIONS",
    widens: (value) => value !== "limited",
  },
  {
    path: ["excluded", "allow"],
    reason: "names commands that run outside the sandbox with no prompt and no sandbox policy",
    widens: isNonEmptyList,
  },
  {
    path: ["excluded", "ask"],
    reason: "names commands that run outside the sandbox once confirmed, with no sandbox policy",
    widens: isNonEmptyList,
  },
];

/**
 * One row of the restriction-loss table. It is the mirror of
 * {@link TrustAffectingSandboxPath}: the value alone says nothing, because these
 * paths restrict, so what matters is what the merge takes away from the list the
 * file already had.
 */
type RestrictionLosingSandboxPath = {
  readonly path: readonly string[];
  readonly reason: string;
  readonly loosens: (args: { before: readonly unknown[]; after: readonly unknown[] }) => boolean;
};

/**
 * `sandbox` paths that restrict, and that therefore loosen the policy by losing
 * entries rather than by holding a value. Devin's config is one file rather than
 * a stack of settings scopes, and the override is shallow-merged over the
 * existing `sandbox` at its top level: each of these lists is replaced whole,
 * and `excluded.deny` vanishes as soon as the override states any other
 * `excluded` key. Losing an entry has the same effect as adding one to the
 * permissive keys above, so it is announced the same way. Claude Code needs no
 * equivalent — it merges its lists across settings scopes, so a file can only
 * ever add to them.
 *
 * `loosens` is asked only about a `before` that actually restricted something,
 * and the two directions are not symmetric: `allowed_domains` restricts by
 * listing what is reachable, so it loosens by gaining entries or by emptying
 * out altogether, while the deny lists loosen by losing entries.
 *
 * @see https://docs.devin.ai/cli/sandbox
 */
const DEVIN_RESTRICTION_LOSING_SANDBOX_PATHS: readonly RestrictionLosingSandboxPath[] = [
  {
    path: ["allowed_domains"],
    reason:
      "adds to the proxy allowlist already in the file, or empties it so every domain becomes reachable again",
    loosens: ({ before, after }) =>
      after.length === 0 || after.some((entry) => !before.includes(entry)),
  },
  {
    path: ["denied_domains"],
    reason: "drops domains the deny list already in the file kept out of reach",
    loosens: ({ before, after }) => before.some((entry) => !after.includes(entry)),
  },
  {
    path: ["excluded", "deny"],
    reason: "drops commands the list already in the file pinned inside the sandbox",
    loosens: ({ before, after }) => before.some((entry) => !after.includes(entry)),
  },
];

/**
 * The reason printed for a value the file held in a shape that cannot be read,
 * which this generate is about to replace. `shape` names what Devin documents
 * there, so the message says which expectation the file's value missed.
 */
const replacedUnreadableReason = (shape: "list" | "object"): string =>
  `replaces a value already in the file that is not the ${shape} Devin documents, so what it restricted cannot be read`;

/**
 * The restrictions this generate would weaken, compared between the `sandbox`
 * already in the file and the one about to replace it. A `before` that is
 * present but not a list is reported outright: a shape Devin may still honor is
 * not something to go quiet about just because it cannot be diffed.
 */
function collectRestrictionLosingSandboxEntries({
  existing,
  merged,
}: {
  existing: Record<string, unknown>;
  merged: Record<string, unknown>;
}): TrustAffectingEntry[] {
  const entries: TrustAffectingEntry[] = [];
  const reportedContainers = new Set<string>();
  for (const { path, reason, loosens } of DEVIN_RESTRICTION_LOSING_SANDBOX_PATHS) {
    const before = readSandboxPath({ sandbox: existing, path });
    if (before === undefined) continue;

    // The merge is shallow at the sandbox's top level, so a path is untouched
    // exactly when its first segment still holds the value the file had —
    // nothing was dropped, whatever shape that value is in. Comparing the leaf
    // reads instead would call two unreadable containers identical.
    const [rootKey] = path;
    if (rootKey !== undefined && existing[rootKey] === merged[rootKey]) continue;

    const after = readSandboxPath({ sandbox: merged, path });

    const label = `sandbox.${path.join(".")}`;
    // A value the file holds that is not the list Devin documents, replaced by
    // one that is: whatever it meant, it is not something to overwrite quietly.
    // The row's own reason would claim entries were dropped, which is exactly
    // what cannot be read here. When it is a container on the way that blocks
    // the read, that container is what the file holds — naming the leaf would
    // send the user looking for a path their file does not have.
    if (before === UNREADABLE_SANDBOX_PATH) {
      const container = findUnreadableContainer({ sandbox: existing, path });
      if (container === undefined || reportedContainers.has(container)) continue;
      reportedContainers.add(container);
      entries.push({ label: container, reason: replacedUnreadableReason("object") });
      continue;
    }
    if (!Array.isArray(before)) {
      entries.push({ label, reason: replacedUnreadableReason("list") });
      continue;
    }
    if (before.length === 0) continue;

    if (!loosens({ before, after: Array.isArray(after) ? after : [] })) continue;

    entries.push({ label, reason });
  }
  return entries;
}

/**
 * Permissions generator for Devin Local (native `.devin/` configuration).
 *
 * Maps rulesync permission actions onto Devin's `permissions` block inside its
 * native config file — `allow` / `deny` / `ask` arrays of scope matchers
 * (`Read(glob)`, `Write(glob)`, `Exec(prefix)`, `Fetch(pattern)`, plus
 * `mcp__server__tool` patterns). Devin evaluates the arrays with strict
 * precedence: `deny` is checked before `ask`, which is checked before `allow`,
 * so a deny rule always wins.
 *
 * - Project scope: `.devin/config.json`
 * - Global scope: `~/.config/devin/config.json`
 *
 * In global mode the config file is shared with the hooks (`hooks`) feature
 * (MCP moved to the dedicated mcp_config.json in v3000.3), so reads and writes
 * merge into the existing JSON and the file is never deleted; only the keys
 * this feature manages are rewritten — `permissions`, plus `sandbox` in global
 * mode when the `devin` override authors it.
 *
 * The sibling `sandbox` block — which decides what a permitted command may
 * reach rather than which commands are permitted — has no canonical category
 * and is authored through the `devin` override in `.rulesync/permissions.jsonc`.
 * Devin documents it as a user-config-only key, so it is written at global
 * scope only.
 *
 * @see https://docs.devin.ai/cli/reference/permissions
 * @see https://docs.devin.ai/cli/sandbox
 */
export class DevinPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * config.json may carry the MCP/hooks features' keys, so it is never deleted;
   * only the keys this feature manages are rewritten — `permissions`, plus
   * `sandbox` in global mode when the `devin` override authors it.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    if (global) {
      return {
        relativeDirPath: DEVIN_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: DEVIN_CONFIG_FILE_NAME,
      };
    }
    return {
      relativeDirPath: DEVIN_DIR,
      relativeFilePath: DEVIN_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<DevinPermissions> {
    const paths = DevinPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new DevinPermissions({
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
    validate = true,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<DevinPermissions> {
    const paths = DevinPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? JSON.stringify({}, null, 2);

    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(existingContent);
      settings = isRecord(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(
        `Failed to parse existing Devin config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToDevinPermissions(config);

    // rulesync owns the scopes present in the permissions config; preserve any
    // existing entries for scopes it does not manage.
    const managedScopes = new Set(
      Object.keys(config.permission).map((category) => toDevinScope(category)),
    );
    const existingPermissions: DevinPermissionsBlock = isRecord(settings.permissions)
      ? (settings.permissions as DevinPermissionsBlock)
      : {};
    const preserve = (entries: string[] | undefined): string[] =>
      (entries ?? []).filter((entry) => !managedScopes.has(parseDevinPermissionEntry(entry).scope));

    const mergedAllow = uniq([...preserve(existingPermissions.allow), ...allow].toSorted());
    const mergedAsk = uniq([...preserve(existingPermissions.ask), ...ask].toSorted());
    const mergedDeny = uniq([...preserve(existingPermissions.deny), ...deny].toSorted());

    const mergedPermissions: Record<string, unknown> = { ...existingPermissions };
    if (mergedAllow.length > 0) mergedPermissions.allow = mergedAllow;
    else delete mergedPermissions.allow;
    if (mergedAsk.length > 0) mergedPermissions.ask = mergedAsk;
    else delete mergedPermissions.ask;
    if (mergedDeny.length > 0) mergedPermissions.deny = mergedDeny;
    else delete mergedPermissions.deny;

    const patch: Record<string, unknown> = { permissions: mergedPermissions };

    // The `devin` override's `sandbox` block. Shallow-merged at its top level so
    // the override's keys win while sibling keys the user set directly are kept.
    // Devin lists `sandbox` as a User Config Only key, so a project config that
    // stated it would simply be ignored — drop it with a warning instead.
    const authoredSandbox = config.devin?.sandbox;
    if (authoredSandbox !== undefined) {
      const authoredSandboxRecord = asDevinRecord(authoredSandbox);
      if (global) {
        const existingSandbox = asDevinRecord(settings.sandbox);
        const mergedSandbox = {
          ...existingSandbox,
          ...authoredSandboxRecord,
        };
        // Materializing `"sandbox": {}` would put a meaningless key — and a
        // diff — into a file that never had one.
        const writesSandbox = Object.keys(mergedSandbox).length > 0;
        if (writesSandbox) {
          patch.sandbox = mergedSandbox;
        }

        // `asDevinRecord` flattens a `sandbox` the file holds in some other
        // shape to `{}`, so the per-path comparison below sees nothing to lose.
        // Whatever it meant to Devin, the write replaces it wholesale.
        const replacesUnreadableSandbox =
          writesSandbox && settings.sandbox !== undefined && !isRecord(settings.sandbox);

        warnOnTrustAffectingEntries({
          toolLabel: "Devin",
          // Not every entry is an addition — a lost restriction is a change to
          // the file, not a setting written into it — so "change" covers both.
          noun: "sandbox change",
          entries: [
            ...(replacesUnreadableSandbox
              ? [{ label: "sandbox", reason: replacedUnreadableReason("object") }]
              : []),
            // The authored block rather than the merged one: a loosening value
            // the file already held is the user's own, and re-announcing it on
            // every generate would bury the values rulesync actually wrote.
            ...collectTrustAffectingSandboxPaths({
              sandbox: authoredSandboxRecord,
              paths: DEVIN_TRUST_AFFECTING_SANDBOX_PATHS,
            }),
            ...collectRestrictionLosingSandboxEntries({
              existing: existingSandbox,
              merged: mergedSandbox,
            }),
          ],
          relativeFilePath: toPosixPath(join(paths.relativeDirPath, paths.relativeFilePath)),
          logger,
        });
      } else if (Object.keys(authoredSandboxRecord).length > 0) {
        // An empty override drops nothing, so announcing a loss would be a lie.
        logger?.warn(
          "Devin reads 'sandbox' from the user config only, so the 'devin.sandbox' override was " +
            "dropped from the project config. Generate with --global to author it.",
        );
      }
    }

    return new DevinPermissions({
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
    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this.getFileContent());
      settings = isRecord(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Devin permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions: DevinPermissionsBlock = isRecord(settings.permissions)
      ? (settings.permissions as DevinPermissionsBlock)
      : {};
    const config = convertDevinToRulesyncPermissions({
      allow: Array.isArray(permissions.allow) ? permissions.allow : [],
      ask: Array.isArray(permissions.ask) ? permissions.ask : [],
      deny: Array.isArray(permissions.deny) ? permissions.deny : [],
    });

    // Route the `sandbox` block into the `devin` override — it has no canonical
    // category. The whole block round-trips, so a key the override did not
    // author is pulled in on the next import rather than being lost.
    //
    // Deliberately not scope-filtered, unlike the generate side. Importing a
    // project `.devin/config.json` that carries a `sandbox` Devin itself would
    // ignore still surfaces it in `.rulesync/permissions.jsonc` where it is
    // reviewable, and the next project generate drops it again with the warning
    // above; silently discarding it here would instead hide a stray block from
    // the person doing the import. claudecode and kilo import their global-only
    // keys the same way.
    const sandbox = asDevinRecord(settings.sandbox);
    const result: Record<string, unknown> = { ...config };
    if (Object.keys(sandbox).length > 0) {
      result.devin = { sandbox };
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
  }: ToolPermissionsForDeletionParams): DevinPermissions {
    // Kept for interface parity; isDeletable() returns false so the shared
    // config.json is never removed by the permissions feature.
    return new DevinPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Devin allow/ask/deny arrays.
 */
function convertRulesyncToDevinPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(honorAllToolsOnBash(config.permission))) {
    const scope = toDevinScope(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildDevinPermissionEntry(scope, pattern);
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
 * Convert Devin allow/ask/deny arrays to rulesync permissions config. Entries
 * are applied allow → ask → deny so the most restrictive action wins for a
 * given (scope, pattern), mirroring Devin's deny > ask > allow precedence.
 */
function convertDevinToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction): void => {
    for (const entry of entries) {
      const { scope, pattern } = parseDevinPermissionEntry(entry);
      // `scope` and `pattern` come from the parsed Devin config. Skip raw
      // prototype-pollution keys before they reach `toCanonicalCategory` (which
      // would otherwise resolve `__proto__`/`constructor` to a non-string via the
      // lookup object) or get used as bracket-notation object keys.
      if (isPrototypePollutionKey(scope) || isPrototypePollutionKey(pattern)) {
        continue;
      }
      const canonical = toCanonicalCategory(scope);
      (permission[canonical] ??= {})[pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}
