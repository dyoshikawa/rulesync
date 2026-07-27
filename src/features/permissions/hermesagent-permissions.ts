import { join } from "node:path";

import {
  HERMESAGENT_CONFIG_FILE_NAME,
  HERMESAGENT_GLOBAL_DIR,
} from "../../constants/hermesagent-paths.js";
import {
  RULESYNC_PERMISSIONS_FILE_NAME,
  RULESYNC_RELATIVE_DIR_PATH,
} from "../../constants/rulesync-paths.js";
import { type AiFileParams, ValidationResult } from "../../types/ai-file.js";
import {
  type PermissionAction,
  type PermissionsConfig,
  RulesyncPermissionsFileSchema,
} from "../../types/permissions.js";
import { readFileContent } from "../../utils/file.js";
import {
  getHermesagentRelativeDirPath,
  getHermesagentRulesyncOutputRoot,
} from "../../utils/hermesagent.js";
import { isRecord, isStringArray } from "../../utils/type-guards.js";
import {
  applySharedConfigPatch,
  HERMES_CONFIG_SHARED_FILE_KEY,
  mergeSharedConfigDeep,
  parseSharedConfig,
  stringifySharedConfig,
} from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
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

function reconcileCommandAllowlist({
  permission,
  commandAllowlist,
}: {
  permission: CanonicalPermissionBlock;
  commandAllowlist: readonly string[];
}): void {
  const nativeAllows = new Set(commandAllowlist);
  const existingAllowCategories = new Map<string, string>();

  for (const [category, rules] of Object.entries(permission)) {
    for (const [pattern, action] of Object.entries(rules)) {
      if (action !== "allow") {
        continue;
      }
      existingAllowCategories.set(pattern, category);
      if (!nativeAllows.has(pattern)) {
        delete rules[pattern];
      }
    }
  }

  for (const pattern of nativeAllows) {
    const existingCategory = existingAllowCategories.get(pattern);
    if (existingCategory) {
      ensureCategory(permission, existingCategory)[pattern] = "allow";
    } else {
      ensureCategory(permission, "bash")[pattern] = "allow";
    }
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
      fileKey: HERMES_CONFIG_SHARED_FILE_KEY,
      feature: "permissions",
      existingContent: fileContent,
      patch: parseSharedConfig({ format: "yaml", fileContent: this.fileContent }),
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    const config = parseSharedConfig({ format: "yaml", fileContent: this.getFileContent() });
    const permissionsRoot = isRecord(config.permissions) ? config.permissions : {};
    const parsedProvenance = RulesyncPermissionsFileSchema.safeParse(permissionsRoot.rulesync);
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
      category: "bash",
      patterns: isStringArray(approvals.deny) ? approvals.deny : [],
    });

    const security = isRecord(config.security) ? config.security : {};
    const websiteBlocklist = isRecord(security.website_blocklist) ? security.website_blocklist : {};
    reconcileNativeDenies({
      permission,
      category: "webfetch",
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
    return new RulesyncPermissions({
      outputRoot: getHermesagentRulesyncOutputRoot({
        nativeOutputRoot: this.outputRoot,
        global: this.global,
      }),
      relativeDirPath: RULESYNC_RELATIVE_DIR_PATH,
      relativeFilePath: RULESYNC_PERMISSIONS_FILE_NAME,
      fileContent: JSON.stringify(imported, null, 2),
    });
  }

  static fromRulesyncPermissions({
    outputRoot,
    rulesyncPermissions,
    global = false,
  }: ToolPermissionsFromRulesyncPermissionsParams): HermesagentPermissions {
    const permissions = rulesyncPermissions.getJson();
    const permissionBlock = permissions.permission ?? {};

    // `allow` patterns (all categories) feed Hermes's command allowlist, as before.
    const commandAllowlist = Object.entries(permissionBlock).flatMap(([, patterns]) =>
      patternsByAction(patterns, "allow"),
    );

    // Map the two canonical deny surfaces onto the structures Hermes's runtime
    // actually enforces (previously dropped): `bash` deny -> `approvals.deny`
    // (a hard denylist evaluated before autonomy mode) and `webfetch` deny ->
    // `security.website_blocklist.domains`. Other categories' deny and every
    // `ask` rule have no native per-pattern Hermes primitive, so they survive
    // only in the round-trip blob below.
    const bashDeny = patternsByAction(permissionBlock.bash, "deny");
    const webfetchDeny = patternsByAction(permissionBlock.webfetch, "deny");

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
