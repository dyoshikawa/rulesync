import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import type { AiFileParams } from "../../types/ai-file.js";
import {
  type PermissionAction,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import { matchesGlob } from "../../utils/glob.js";
import {
  getHermesagentConfigSharedFileKey,
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
} from "../../utils/hermesagent.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord, isStringArray, toRecord } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  mergeSharedConfigDeep,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions, withoutBlankPermissionKeysIn } from "./rulesync-permissions.js";
import {
  ALL_TOOLS_PERMISSION_CATEGORY,
  CATCH_ALL_PATTERN,
  collectShellCommandRules,
  MCP_CATEGORY_PREFIX,
  partitionCommandRules,
  SHELL_PERMISSION_CATEGORY,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
} from "./tool-permissions.js";

type HermesagentPermissionsParams = Omit<AiFileParams, "relativeDirPath" | "relativeFilePath">;

/** Collect the glob patterns in a canonical category that carry a given action. */
function patternsByAction(
  category: Record<string, PermissionAction> | undefined,
  action: PermissionAction,
): string[] {
  return Object.entries(category ?? {})
    .filter(([, value]) => value === action)
    .map(([pattern]) => pattern);
}

type CanonicalPermissionBlock = Record<string, Record<string, PermissionAction>>;

/** The canonical category whose `deny` rules feed `security.website_blocklist`. */
const WEBFETCH_PERMISSION_CATEGORY = "webfetch";

function clonePermissionBlock(
  permission: PermissionsConfig["permission"],
): CanonicalPermissionBlock {
  return Object.fromEntries(
    Object.entries(permission).map(([category, rules]) => [category, { ...rules }]),
  );
}

function deleteRulesByAction(
  rules: Record<string, PermissionAction>,
  action: PermissionAction,
): void {
  for (const [pattern, currentAction] of Object.entries(rules)) {
    if (currentAction === action) {
      delete rules[pattern];
    }
  }
}

function ensureCategory(
  permission: CanonicalPermissionBlock,
  category: string,
): Record<string, PermissionAction> {
  return (permission[category] ??= {});
}

function removeEmptyCategories(permission: CanonicalPermissionBlock): void {
  for (const [category, rules] of Object.entries(permission)) {
    if (Object.keys(rules).length === 0) {
      delete permission[category];
    }
  }
}

/** The prefix Hermes's MCP trust gate keys its persisted "Always" answers with. */
const MCP_ALLOWLIST_PREFIX = "mcp:";

/**
 * Whether a `command_allowlist` entry is an MCP trust-gate grant rather than a
 * shell-command pattern. Since Hermes Agent v0.22.6, answering **Always** to
 * the approval prompt of a `trust: untrusted` MCP server appends
 * `mcp:<server>/<tool>` to `command_allowlist` (`_trust_approval_key` in
 * `tools/mcp_tool_handlers.py`), and the gate looks the key up by exact set
 * membership, so no `mcp:` entry is ever a command.
 */
function isMcpAllowlistEntry(entry: string): boolean {
  return entry.startsWith(MCP_ALLOWLIST_PREFIX);
}

/**
 * The canonical category (`mcp__<server>__<tool>`) a Hermes `mcp:<server>/<tool>`
 * grant stands for, or `null` when it has none: a malformed entry, a server
 * name containing `__` (the canonical name would read back as another server),
 * or a `*` in either name (Hermes compares the key literally, while a canonical
 * `*` is a wildcard).
 */
function mcpAllowlistEntryToCategory(entry: string): string | null {
  const parsed = parseMcpAllowlistEntry(entry);
  if (parsed === null) return null;
  const { server, tool } = parsed;
  if (server.includes("__") || server.includes(CATCH_ALL_PATTERN)) return null;
  if (tool.includes(CATCH_ALL_PATTERN)) return null;
  return `${MCP_CATEGORY_PREFIX}${server}__${tool}`;
}

/** The server and tool an `mcp:<server>/<tool>` entry names, or `null` when it is malformed. */
function parseMcpAllowlistEntry(entry: string): { server: string; tool: string } | null {
  if (!isMcpAllowlistEntry(entry)) return null;
  const rest = entry.slice(MCP_ALLOWLIST_PREFIX.length);
  const slash = rest.indexOf("/");
  const server = slash === -1 ? "" : rest.slice(0, slash);
  const tool = slash === -1 ? "" : rest.slice(slash + 1);
  return server.length === 0 || tool.length === 0 ? null : { server, tool };
}

/**
 * The server and tool a canonical `mcp__<server>__<tool>` category names, or
 * `null` when it names no single tool (a whole server, a wildcard, or the bare
 * `mcp` category). Only such a category can become one Hermes grant.
 */
function parseMcpToolCategory(category: string): { server: string; tool: string } | null {
  if (!category.startsWith(MCP_CATEGORY_PREFIX)) return null;
  const remainder = category.slice(MCP_CATEGORY_PREFIX.length);
  const separator = remainder.indexOf("__");
  if (separator <= 0) return null;
  const server = remainder.slice(0, separator);
  const tool = remainder.slice(separator + 2);
  // A `/` in the server name would move the split of `mcp:<server>/<tool>`
  // and read back as another server.
  if (
    tool.length === 0 ||
    server.includes("/") ||
    server.includes(CATCH_ALL_PATTERN) ||
    tool.includes(CATCH_ALL_PATTERN)
  ) {
    return null;
  }
  return { server, tool };
}

function isMcpCategory(category: string): boolean {
  return category === "mcp" || category.startsWith(MCP_CATEGORY_PREFIX);
}

function isRestricting(action: PermissionAction | undefined): boolean {
  return action === "deny" || action === "ask";
}

/** The first `deny` or `ask` rule of a category, as `<category>: <pattern> (<action>)`. */
function firstRestrictingRule(
  category: string,
  rules: Record<string, PermissionAction> | undefined,
  covers: (pattern: string) => boolean = () => true,
): string | null {
  const found = Object.entries(rules ?? {}).find(
    ([pattern, action]) => isRestricting(action) && covers(pattern),
  );
  return found ? `${category}: ${found[0]} (${found[1]})` : null;
}

/**
 * Whether an MCP name glob (the remainder of an `mcp__...` category, or a
 * pattern of the bare `mcp` category) covers `server`'s tool `tool`: it names
 * the tool (`github__delete_repo`, `github__*`, `*__delete_repo`, `*`) or the
 * whole server (`github`).
 */
function mcpNameGlobCovers(glob: string, server: string, tool: string): boolean {
  return (
    glob === `${server}__${tool}` ||
    glob === server ||
    matchesGlob(glob, `${server}__${tool}`) ||
    matchesGlob(glob, server)
  );
}

/**
 * The `deny` or `ask` rule that outranks an allow on `server`'s tool `tool`, or
 * `null` when none does: any one under the all-tools `*` category (a rule there
 * applies to every tool, so even a narrower pattern restricts some of the
 * tool's calls), one under the bare `mcp` category whose pattern covers the
 * tool, or any one in an `mcp__...` category whose name covers the tool — its
 * own category included, since a deny or ask scoped to some of its calls still
 * forbids approving all of them. A Hermes grant approves every call of the
 * tool and Hermes has no ask tier, so such an allow is withheld, the same way
 * a `bash` allow a stricter rule covers is.
 */
function findMcpToolRestriction(
  permission: PermissionsConfig["permission"],
  server: string,
  tool: string,
): string | null {
  for (const [category, rules] of Object.entries(permission)) {
    let found: string | null = null;
    if (category === ALL_TOOLS_PERMISSION_CATEGORY) {
      found = firstRestrictingRule(category, rules);
    } else if (category === "mcp") {
      found = firstRestrictingRule(category, rules, (pattern) =>
        mcpNameGlobCovers(pattern, server, tool),
      );
    } else if (
      category.startsWith(MCP_CATEGORY_PREFIX) &&
      mcpNameGlobCovers(category.slice(MCP_CATEGORY_PREFIX.length), server, tool)
    ) {
      found = firstRestrictingRule(category, rules);
    }
    if (found !== null) return found;
  }
  return null;
}

function isMcpToolRestricted(
  permission: PermissionsConfig["permission"],
  server: string,
  tool: string,
): boolean {
  return findMcpToolRestriction(permission, server, tool) !== null;
}

/**
 * Translate the canonical MCP `allow` rules into Hermes trust-gate grants: a
 * `*` allow on `mcp__<server>__<tool>` becomes `mcp:<server>/<tool>`. Every
 * other MCP allow (a whole server, a wildcard, a narrower pattern) has no
 * Hermes spelling, and an allow a deny or ask covers is withheld.
 */
function collectMcpAllowlistEntries(permission: PermissionsConfig["permission"]): {
  entries: string[];
  withheldCategories: string[];
  unexpressedRules: string[];
} {
  const entries: string[] = [];
  const withheldCategories: string[] = [];
  const unexpressedRules: string[] = [];
  for (const [category, rules] of Object.entries(permission)) {
    if (!isMcpCategory(category)) continue;
    const parsed = parseMcpToolCategory(category);
    for (const pattern of patternsByAction(rules, "allow")) {
      if (parsed === null || pattern !== CATCH_ALL_PATTERN) {
        unexpressedRules.push(`${category}: ${pattern}`);
      } else {
        const restriction = findMcpToolRestriction(permission, parsed.server, parsed.tool);
        if (restriction === null) {
          entries.push(`${MCP_ALLOWLIST_PREFIX}${parsed.server}/${parsed.tool}`);
        } else {
          withheldCategories.push(`${category} (covered by ${restriction})`);
        }
      }
    }
  }
  return { entries, withheldCategories, unexpressedRules };
}

function warnAboutUnwrittenMcpAllows({
  withheldCategories,
  unexpressedRules,
  logger,
}: {
  withheldCategories: readonly string[];
  unexpressedRules: readonly string[];
  logger?: Logger | undefined;
}): void {
  if (withheldCategories.length > 0) {
    warnWithFallback(
      logger,
      `Hermes Agent's command_allowlist was not given the MCP allow rule(s) for ` +
        `${withheldCategories.join(", ")}: a deny or ask rule covers each, a Hermes grant ` +
        `approves every call of the tool, and Hermes has no ask tier.`,
    );
  }
  if (unexpressedRules.length > 0) {
    warnWithFallback(
      logger,
      `Hermes Agent grants MCP tools one at a time (command_allowlist entries ` +
        `'mcp:<server>/<tool>'), so only a '*' allow on an 'mcp__<server>__<tool>' category ` +
        `can be written; the MCP allow rule(s) ${unexpressedRules.join(", ")} were skipped ` +
        `and survive only in the permissions.rulesync round-trip block.`,
    );
  }
}

/**
 * Make the native `mcp:<server>/<tool>` grants authoritative for the canonical
 * single-tool MCP allows they can speak for. An allow the generator withheld
 * because a deny or ask covers it was never written, so its absence
 * is not a retraction and it is kept, as is every MCP allow with no Hermes
 * spelling. A grant with no canonical spelling stays only in Hermes, where
 * generation keeps it (see `setFileContent`).
 */
function reconcileMcpAllowlist({
  permission,
  mcpEntries,
  logger,
}: {
  permission: CanonicalPermissionBlock;
  mcpEntries: readonly string[];
  logger?: Logger | undefined;
}): void {
  for (const [category, rules] of Object.entries(permission)) {
    const parsed = parseMcpToolCategory(category);
    if (
      parsed !== null &&
      rules[CATCH_ALL_PATTERN] === "allow" &&
      !isMcpToolRestricted(permission, parsed.server, parsed.tool)
    ) {
      delete rules[CATCH_ALL_PATTERN];
    }
  }
  const keptRestrictions: string[] = [];
  for (const entry of mcpEntries) {
    const category = mcpAllowlistEntryToCategory(entry);
    if (category === null) continue;
    const rules = ensureCategory(permission, category);
    // A deny or ask the canonical block already holds is the author's word on
    // the tool; the grant is left to Hermes (generation keeps it unmanaged
    // only while nothing restricts it) rather than overturning the rule.
    if (isRestricting(rules[CATCH_ALL_PATTERN])) {
      keptRestrictions.push(entry);
      continue;
    }
    rules[CATCH_ALL_PATTERN] = "allow";
  }
  if (keptRestrictions.length > 0) {
    warnWithFallback(
      logger,
      `Hermes Agent's command_allowlist grants ${keptRestrictions.join(", ")}, but the ` +
        `permissions.rulesync block denies or asks for those MCP tools; the canonical rule ` +
        `was kept and the grant was not imported.`,
    );
  }
}

/**
 * The `mcp:` grants in an existing `command_allowlist` that rulesync does not
 * manage and must keep when it rewrites the list: Hermes appends one whenever
 * the user answers **Always** on an untrusted MCP server, so dropping it would
 * silently revoke the grant. A grant is managed — and so retracted with its
 * canonical rule — when the previous or the new canonical block has a rule
 * for its `mcp__<server>__<tool>` category, or when the new block restricts
 * the tool in any way.
 */
function unmanagedMcpAllowlistEntries({
  existing,
  previousPermission,
  nextPermission,
  nextAllowlist,
}: {
  existing: Record<string, unknown>;
  previousPermission: Record<string, unknown>;
  nextPermission: PermissionsConfig["permission"];
  nextAllowlist: readonly string[];
}): string[] {
  const existingAllowlist = isStringArray(existing.command_allowlist)
    ? existing.command_allowlist
    : [];
  return existingAllowlist.filter((entry) => {
    if (!isMcpAllowlistEntry(entry) || nextAllowlist.includes(entry)) return false;
    // A grant the new block restricts (by a deny or ask on the tool, its server,
    // or a glob covering it) must not outlive that rule.
    const parsed = parseMcpAllowlistEntry(entry);
    if (parsed !== null && isMcpToolRestricted(nextPermission, parsed.server, parsed.tool)) {
      return false;
    }
    const category = mcpAllowlistEntryToCategory(entry);
    return (
      category === null ||
      (!Object.hasOwn(previousPermission, category) && !Object.hasOwn(nextPermission, category))
    );
  });
}

/** The validated canonical `permission` block of a config's `permissions.rulesync` blob. */
function canonicalPermissionOf(config: Record<string, unknown>): PermissionsConfig["permission"] {
  const parsed = RulesyncPermissionsFileSchema.safeParse({
    permission: provenancePermissionOf(config),
  });
  return parsed.success ? parsed.data.permission : {};
}

/** The canonical `permission` block of a config's `permissions.rulesync` blob, if any. */
function provenancePermissionOf(config: Record<string, unknown>): Record<string, unknown> {
  const permissionsRoot = toRecord(config.permissions);
  const provenance = toRecord(permissionsRoot.rulesync);
  return toRecord(provenance.permission);
}

/**
 * Make the native `command_allowlist` authoritative for the `bash` allow rules
 * it can speak for, and for those only. The allowlist is a list of shell-command
 * patterns, so it is generated from `bash` alone (see `fromRulesyncPermissions`);
 * an allow in any other category names something Hermes's allowlist cannot
 * carry, so its absence from the list says nothing about it and it is kept as
 * provenance wrote it. The same holds for a `bash` allow the generator withheld
 * because a stricter `*` or `bash` rule covers it: the allowlist never carried
 * it, so its absence is not a retraction and the rule is kept too.
 */
function reconcileCommandAllowlist({
  permission,
  commandAllowlist,
}: {
  permission: CanonicalPermissionBlock;
  commandAllowlist: readonly string[];
}): void {
  const { rules: commandRules } = collectShellCommandRules(permission);
  const { shadowedAllowPatterns } = partitionCommandRules({
    rules: commandRules,
    writesAllToolsDeny: false,
  });
  const withheld = new Set(shadowedAllowPatterns);
  const isWithheld = (pattern: string) => withheld.has(pattern) || isMcpAllowlistEntry(pattern);
  const rules = ensureCategory(permission, SHELL_PERMISSION_CATEGORY);
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "allow" && !isWithheld(pattern)) {
      delete rules[pattern];
    }
  }
  for (const pattern of commandAllowlist) {
    rules[pattern] = "allow";
  }
}

/**
 * Report the restricting rules Hermes has no per-pattern primitive for: a
 * `deny` or `ask` in any category other than `bash`, `*`, and `webfetch`, and
 * an `ask` under `webfetch` — the blocklist carries a `webfetch` deny but has
 * no ask tier. (`bash` and `*` are reported by `warnAboutUnwrittenCommandRules`.)
 * Such rules survive only in the round-trip blob.
 */
function warnAboutUnexpressedHermesRestrictions({
  permissionBlock,
  foreignRestrictingCategories,
  logger,
}: {
  permissionBlock: PermissionsConfig["permission"];
  foreignRestrictingCategories: readonly string[];
  logger?: Logger | undefined;
}): void {
  for (const category of foreignRestrictingCategories) {
    const isWebfetch = category === WEBFETCH_PERMISSION_CATEGORY;
    if (isWebfetch && patternsByAction(permissionBlock[category], "ask").length === 0) {
      continue;
    }
    warnWithFallback(
      logger,
      isWebfetch
        ? `Hermes Agent's security.website_blocklist has no ask tier, so the 'webfetch' ask ` +
            `rule(s) cannot be represented and were skipped; they survive only in the ` +
            `permissions.rulesync round-trip block.`
        : `Hermes Agent has no per-pattern primitive for '${category}' deny and ask rules ` +
            `(it enforces command_allowlist, approvals.deny, and security.website_blocklist), ` +
            `so they were skipped; they survive only in the permissions.rulesync round-trip block.`,
    );
  }
}

function reconcileNativeDenies({
  permission,
  category,
  patterns,
}: {
  permission: CanonicalPermissionBlock;
  category: string;
  patterns: readonly string[];
}): void {
  const rules = ensureCategory(permission, category);
  deleteRulesByAction(rules, "deny");
  for (const pattern of patterns) {
    rules[pattern] = "deny";
  }
}

function withoutKey(record: Record<string, unknown>, key: string): Record<string, unknown> {
  return Object.fromEntries(Object.entries(record).filter(([entryKey]) => entryKey !== key));
}

function buildHermesOverride(
  config: Record<string, unknown>,
  provenance: PermissionsConfig,
): Record<string, unknown> {
  const base = isRecord(provenance.hermes) ? { ...provenance.hermes } : {};
  const approvals = toRecord(config.approvals);
  const approvalsOverride = withoutKey(approvals, "deny");
  if (Object.keys(approvalsOverride).length > 0) {
    base.approvals = approvalsOverride;
  } else {
    delete base.approvals;
  }

  const security = isRecord(config.security) ? { ...config.security } : {};
  const blocklist = isRecord(security.website_blocklist)
    ? { ...security.website_blocklist }
    : undefined;
  if (blocklist?.enabled === true) {
    delete blocklist.domains;
    delete blocklist.enabled;
  }
  if (blocklist && Object.keys(blocklist).length > 0) {
    security.website_blocklist = blocklist;
  } else {
    delete security.website_blocklist;
  }
  if (Object.keys(security).length > 0) {
    base.security = security;
  } else {
    delete base.security;
  }

  for (const key of ["skills", "memory"] as const) {
    if (isRecord(config[key])) {
      base[key] = config[key];
    } else {
      delete base[key];
    }
  }
  return base;
}

export class HermesagentPermissions extends ToolPermissions {
  static getSettablePaths({ global = false }: { global?: boolean } = {}) {
    return {
      relativeDirPath: getHermesagentRelativeDirPath({
        global,
        relativeDirPath: HERMESAGENT_GLOBAL_DIR,
      }),
      relativeFilePath: HERMESAGENT_CONFIG_FILE_NAME,
    };
  }

  /**
   * `config.yaml` under every spelling the global profile root can take.
   * @see getHermesagentSharedConfigWritePaths
   */
  static getExtraSharedWritePaths(): SharedWritePath[] {
    return getHermesagentSharedConfigWritePaths();
  }

  constructor(params: HermesagentPermissionsParams) {
    super({
      ...params,
      ...HermesagentPermissions.getSettablePaths({ global: params.global }),
    });
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<HermesagentPermissions> {
    const paths = this.getSettablePaths({ global });
    return new HermesagentPermissions({
      outputRoot,
      fileContent: await readFileContent(
        join(outputRoot, paths.relativeDirPath, paths.relativeFilePath),
      ),
      validate,
      global,
    });
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    const patch = parseSharedConfig({ format: "yaml", fileContent: this.fileContent });
    // `command_allowlist` is replaced wholesale, which would drop the MCP
    // trust-gate grants Hermes itself appended; keep the ones rulesync does
    // not manage.
    if (isStringArray(patch.command_allowlist)) {
      const existing = parseSharedConfig({ format: "yaml", fileContent });
      const kept = unmanagedMcpAllowlistEntries({
        existing,
        previousPermission: provenancePermissionOf(existing),
        nextPermission: canonicalPermissionOf(patch),
        nextAllowlist: patch.command_allowlist,
      });
      if (kept.length > 0) {
        patch.command_allowlist = [...patch.command_allowlist, ...kept];
      }
    }
    this.fileContent = applySharedConfigPatch({
      fileKey: getHermesagentConfigSharedFileKey({ global: this.global }),
      feature: "permissions",
      existingContent: fileContent,
      patch,
    });
  }

  toRulesyncPermissions({ logger }: { logger?: Logger } = {}): RulesyncPermissions {
    const config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    const permissionsRoot = toRecord(config.permissions);
    // Filter before validating: the provenance block is a canonical document
    // that a user may have hand-edited, and one blank pattern or category would
    // fail the schema and discard every rule recorded here without a word.
    const rawProvenance = permissionsRoot.rulesync;
    const parsedProvenance = RulesyncPermissionsFileSchema.safeParse(
      isRecord(rawProvenance)
        ? withoutBlankPermissionKeysIn({
            config: rawProvenance,
            sourcePath: this.getRelativePathFromCwd(),
          })
        : rawProvenance,
    );
    const provenance: PermissionsConfig = parsedProvenance.success
      ? parsedProvenance.data
      : { permission: {} };
    const permission = clonePermissionBlock(provenance.permission);
    const commandAllowlist = isStringArray(config.command_allowlist)
      ? config.command_allowlist
      : [];
    // `mcp:<server>/<tool>` entries are MCP trust-gate grants, not commands.
    reconcileCommandAllowlist({
      permission,
      commandAllowlist: commandAllowlist.filter((entry) => !isMcpAllowlistEntry(entry)),
    });
    reconcileMcpAllowlist({
      permission,
      mcpEntries: commandAllowlist.filter(isMcpAllowlistEntry),
      logger,
    });

    const approvals = toRecord(config.approvals);
    reconcileNativeDenies({
      permission,
      category: SHELL_PERMISSION_CATEGORY,
      patterns: isStringArray(approvals.deny) ? approvals.deny : [],
    });

    const security = toRecord(config.security);
    const websiteBlocklist = toRecord(security.website_blocklist);
    reconcileNativeDenies({
      permission,
      category: WEBFETCH_PERMISSION_CATEGORY,
      patterns:
        websiteBlocklist.enabled === true && isStringArray(websiteBlocklist.domains)
          ? websiteBlocklist.domains
          : [],
    });
    removeEmptyCategories(permission);

    const { permission: _permission, hermes: _hermes, ...otherProvenance } = provenance;
    const hermes = buildHermesOverride(config, provenance);
    const imported: PermissionsConfig = {
      ...otherProvenance,
      permission,
      ...(Object.keys(hermes).length > 0 && { hermes }),
    };
    return RulesyncPermissions.fromImportedFileContent({
      outputRoot: getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      sourcePath: this.getRelativePathFromCwd(),
      fileContent: JSON.stringify(imported, null, 2),
    });
  }

  static fromRulesyncPermissions({
    outputRoot,
    rulesyncPermissions,
    global = false,
    logger,
  }: ToolPermissionsFromRulesyncPermissionsParams): HermesagentPermissions {
    const permissions = rulesyncPermissions.getJson();
    const permissionBlock = permissions.permission ?? {};

    // `command_allowlist` is a list of shell-command patterns, so only the
    // `bash` category may feed it: a `read` or `edit` allow names a path, and
    // an all-tools `*` allow need not name a command either, so writing them
    // there would auto-approve commands the author never spoke about. The
    // restricting rules of `*` are read all the same — a rule written there
    // covers shell commands too — and, like a `bash` ask, they withhold the
    // allow rules they cover: Hermes has no ask tier, and its denylist is kept
    // for patterns that are commands by construction (see below).
    const { rules, foreignRestrictingCategories, ignoredAllToolsAllowPatterns } =
      collectShellCommandRules(permissionBlock);
    const {
      allow: commandAllowlist,
      deny: bashDeny,
      shadowedAllowPatterns,
      unwrittenDenyPatterns,
      unenforcedAllToolsAskPatterns,
      intersectionBudgetExhausted,
    } = partitionCommandRules({ rules, writesAllToolsDeny: false });
    warnAboutUnexpressedHermesRestrictions({
      permissionBlock,
      foreignRestrictingCategories,
      logger,
    });
    warnAboutUnwrittenCommandRules({
      toolLabel: "Hermes Agent",
      surfaceLabel: "command_allowlist/approvals.deny",
      foreignRestrictingCategories: [],
      shadowedAllowPatterns,
      unwrittenDenyPatterns,
      unwrittenDenyReason:
        "approvals.deny is a hard denylist of shell commands, and a pattern written under " +
        "'*' need not be a command at all.",
      unenforcedAllToolsAskPatterns,
      ignoredAllToolsAllowPatterns,
      intersectionBudgetExhausted,
      logger,
    });

    // Map the two canonical deny surfaces onto the structures Hermes's runtime
    // actually enforces: `bash` deny -> `approvals.deny` (a hard denylist
    // evaluated before autonomy mode) and `webfetch` deny ->
    // `security.website_blocklist.domains`. A `*` deny or ask and a `bash` ask
    // already shaped the output above by withholding the allows they cover;
    // other categories' deny and ask rules have no native per-pattern Hermes
    // primitive, so they survive only in the round-trip blob below.
    const webfetchDeny = patternsByAction(permissionBlock[WEBFETCH_PERMISSION_CATEGORY], "deny");

    // A `*` allow on `mcp__<server>__<tool>` is the canonical spelling of the
    // grant Hermes's MCP trust gate persists as `mcp:<server>/<tool>`.
    const mcpAllows = collectMcpAllowlistEntries(permissionBlock);
    warnAboutUnwrittenMcpAllows({ ...mcpAllows, logger });
    // A `bash` allow spelled `mcp:<server>/<tool>` is not a command: Hermes
    // would read it as an MCP grant, past every MCP deny or ask.
    const bashMcpAllows = commandAllowlist.filter(isMcpAllowlistEntry);
    if (bashMcpAllows.length > 0) {
      warnWithFallback(
        logger,
        `Hermes Agent reads 'mcp:' entries in command_allowlist as MCP tool grants, so the ` +
          `bash allow rule(s) ${bashMcpAllows.join(", ")} were skipped; write them as a '*' ` +
          `allow on an 'mcp__<server>__<tool>' category instead.`,
      );
    }
    const allowlist = [
      ...commandAllowlist.filter((entry) => !isMcpAllowlistEntry(entry)),
      ...mcpAllows.entries,
    ];

    let config: Record<string, unknown> = {};
    if (allowlist.length > 0) config.command_allowlist = allowlist;
    if (bashDeny.length > 0) config.approvals = { deny: bashDeny };
    if (webfetchDeny.length > 0) {
      // `website_blocklist.enabled` defaults to false in Hermes, so the blocklist
      // is inert unless it is explicitly enabled — emit `enabled: true` alongside
      // the domains, otherwise the deny would be written but never enforced.
      config.security = { website_blocklist: { enabled: true, domains: webfetchDeny } };
    }

    // Overlay the Hermes-scoped override (approvals.mode, security.*,
    // skills.write_approval, ...). Deep-merged so it coexists with the natively
    // emitted `approvals`/`security` structures instead of clobbering them.
    if (permissions.hermes && typeof permissions.hermes === "object") {
      config = mergeSharedConfigDeep({
        base: config,
        patch: permissions.hermes as Record<string, unknown>,
      });
    }

    // Keep the full canonical config under the rulesync-private key for a
    // lossless round-trip back to `.rulesync/permissions.jsonc`.
    config.permissions = { rulesync: permissions };

    return new HermesagentPermissions({
      outputRoot,
      fileContent: stringifySharedConfig({ format: "yaml", document: config }),
      global,
    });
  }
}
