import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import type { SharedWritePath } from "../../lib/shared-file-derive.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionAction,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import {
  getHermesagentConfigSharedFileKey,
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
  getHermesagentSharedConfigWritePaths,
} from "../../utils/hermesagent.js";
import { type Logger, warnWithFallback } from "../../utils/logger.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  mergeSharedConfigDeep,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions, withoutBlankPermissionKeysIn } from "./rulesync-permissions.js";
import {
  collectShellCommandRules,
  partitionCommandRules,
  SHELL_PERMISSION_CATEGORY,
  warnAboutUnwrittenCommandRules,
} from "./shell-command-categories.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
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

/**
 * Make the native `command_allowlist` authoritative for the `bash` allow rules,
 * and for those only. The allowlist is a list of shell-command patterns, so it
 * is generated from `bash` alone (see `fromRulesyncPermissions`); an allow in
 * any other category names something Hermes's allowlist cannot carry, so its
 * absence from the list says nothing about it and it is kept as provenance
 * wrote it.
 */
function reconcileCommandAllowlist({
  permission,
  commandAllowlist,
}: {
  permission: CanonicalPermissionBlock;
  commandAllowlist: readonly string[];
}): void {
  const rules = ensureCategory(permission, SHELL_PERMISSION_CATEGORY);
  deleteRulesByAction(rules, "allow");
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
  const approvals = isRecord(config.approvals) ? config.approvals : {};
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

  validate(): ValidationResult {
    return { success: true, error: null };
  }

  override isDeletable(): boolean {
    return false;
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

  static forDeletion({
    outputRoot = process.cwd(),
    global = false,
  }: ToolPermissionsForDeletionParams): HermesagentPermissions {
    return new HermesagentPermissions({ outputRoot, fileContent: "", validate: false, global });
  }

  shouldMergeExistingFileContent(): boolean {
    return true;
  }

  setFileContent(fileContent: string): void {
    this.fileContent = applySharedConfigPatch({
      fileKey: getHermesagentConfigSharedFileKey({ global: this.global }),
      feature: "permissions",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "yaml", fileContent: this.fileContent }),
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    const permissionsRoot = isRecord(config.permissions) ? config.permissions : {};
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
    reconcileCommandAllowlist({ permission, commandAllowlist });

    const approvals = isRecord(config.approvals) ? config.approvals : {};
    reconcileNativeDenies({
      permission,
      category: SHELL_PERMISSION_CATEGORY,
      patterns: isStringArray(approvals.deny) ? approvals.deny : [],
    });

    const security = isRecord(config.security) ? config.security : {};
    const websiteBlocklist = isRecord(security.website_blocklist) ? security.website_blocklist : {};
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
    // `security.website_blocklist.domains`. Other categories' deny and every
    // `ask` rule have no native per-pattern Hermes primitive, so they survive
    // only in the round-trip blob below.
    const webfetchDeny = patternsByAction(permissionBlock[WEBFETCH_PERMISSION_CATEGORY], "deny");

    let config: Record<string, unknown> = {};
    if (commandAllowlist.length > 0) config.command_allowlist = commandAllowlist;
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
