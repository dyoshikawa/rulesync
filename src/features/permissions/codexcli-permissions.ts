import { isAbsolute, join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEXCLI_BASH_RULES_FILE_NAME,
  CODEXCLI_DIR,
  CODEXCLI_MCP_FILE_NAME,
  CODEXCLI_OVERRIDE_KEYS,
  CODEXCLI_RULES_DIR_PATH,
} from "../../constants/codexcli-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import {
  CODEX_EXTENDABLE_BASELINE_PROFILES,
  type PermissionAction,
  type PermissionsConfig,
} from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
import { applySharedConfigPatch, sharedConfigFileKey } from "../shared/shared-config-gateway.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

const RULESYNC_PROFILE_NAME = "rulesync";
const CODEX_WORKSPACE_ROOTS_KEY = ":workspace_roots";
const CODEX_WORKSPACE_BASELINE = ":workspace";
const CODEX_READ_ONLY_BASELINE = ":read-only";
// Codex rejects `extends = ":danger-full-access"`, but the built-in can be
// SELECTED directly via `default_permissions`, which is how the
// `codexcli.base_permission_profile: ":danger-full-access"` override is
// honored (the managed profile is skipped entirely in that mode).
const CODEX_DANGER_FULL_ACCESS_BASELINE = ":danger-full-access";
// Built-in profiles the managed profile's `extends` may reference, derived
// from the schema constant so generate and import share one source.
// `:workspace` is the default baseline when
// `codexcli.base_permission_profile` is unspecified.
const CODEX_EXTENDABLE_BASELINES = new Set<string>(CODEX_EXTENDABLE_BASELINE_PROFILES);
// Defaults emitted when neither the `codexcli` override nor the existing
// config.toml sets the key (an existing user-set value is never clobbered).
const CODEX_DEFAULT_APPROVAL_POLICY = "on-request";
const CODEX_DEFAULT_APPROVALS_REVIEWER = "auto_review";
const CODEX_GLOB_SCAN_MAX_DEPTH = 8; // Matches Codex CLI default glob_scan_max_depth
// `:minimal = "read"` enables `include_platform_defaults()` (FileSystemSpecialPath::Minimal,
// openai/codex#13434), providing platform/runtime read access for basic sandboxed command execution.
// It is always emitted as a fixed baseline and is the only special filesystem path that rulesync
// does not import into its own model (a canonical `:minimal` rule still overrides the emitted
// value on generate, but the value never round-trips through import). All other special paths such as
// `:root`, `:tmpdir`, and `:slash_tmp` are treated like ordinary filesystem rules: they are
// imported into the rulesync model and re-emitted from it, so they round-trip without relying on
// an existing config file being present. Keys mirror parse_special_path in
// codex-rs/config/src/permissions_toml.rs.
const CODEX_MINIMAL_KEY = ":minimal";
// Default `.git` carve-out emitted into the `:workspace_roots` table unless
// `codexcli.git_write_rules` is explicitly `false`. Codex's `:workspace`
// baseline keeps `.git` read-only inside workspace roots
// (append_default_read_only_project_root_subpath_if_no_explicit_rule in
// codex-rs), which denies basic git workflows: commit/stage operations write
// to `.git/index`, `.git/objects`, refs, and logs. `".git/**" = "write"`
// reopens the whole subtree, including `.git/config` — everyday commands such
// as `git remote add`/`set-url`, `git push -u` (records
// `branch.<name>.remote`/`merge`), local-scope `git config`, and
// clone/submodule flows all write to the repository config, so keeping it
// read-only breaks basic workflows. An earlier `".git/config" = "read"`
// security guard was dropped for that reason (#2279): the protection it added
// was already partial by design — `.git/hooks/` stays writable so hook
// managers such as lefthook and simple-git-hooks keep working (a maintainer
// decision on #2272) — so the cost/benefit did not hold. Users who want
// stricter isolation can author e.g. `read: { ".git/config": "allow" }` or
// `read: { ".git/hooks/**": "allow" }` in the canonical permissions — a user
// rule for a more specific path wins over the default (Codex resolves the
// more specific path with priority).
//
// Like `:minimal`, this default-valued entry is not imported into the
// rulesync model (it is re-added on every export); a user-customized value
// for the same key imports — and generates — normally, winning over the
// default.
const CODEX_GIT_WRITE_RULES: Readonly<Record<string, "read" | "write">> = {
  ".git/**": "write",
};
// Codex rejects the global `*` wildcard in denied network domains at config load time,
// while allowed domains accept it for denylist-only setups (openai/codex#15549).
const GLOBAL_WILDCARD_DOMAIN = "*";

// `none` is accepted on import for configs generated before Codex CLI v0.131.0.
type CodexFilesystemAccess = "read" | "write" | "deny" | "none";
type CodexFilesystemRuleTable = Record<string, CodexFilesystemAccess>;
type CodexFilesystem = Record<string, CodexFilesystemAccess | CodexFilesystemRuleTable | number>;

type CodexNetwork = {
  enabled?: boolean;
  mode?: string;
  domains?: Record<string, "allow" | "deny">;
  // Pass-through only: values are preserved verbatim because Rulesync does not manage them.
  unix_sockets?: Record<string, string>;
};

type CodexPermissionProfile = {
  description?: string;
  extends?: string;
  filesystem?: CodexFilesystem;
  network?: CodexNetwork;
};

type CodexProfileParseResult = {
  profile: CodexPermissionProfile | undefined;
  /** The domains table existed but contained entries with unrecognized values. */
  domainsHadUnknown: boolean;
};

type UnknownTable = Record<string, unknown>;

export class CodexcliPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: CODEXCLI_DIR,
      relativeFilePath: CODEXCLI_MCP_FILE_NAME,
    };
  }

  override isDeletable(): boolean {
    return false;
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<CodexcliPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});

    return new CodexcliPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<CodexcliPermissions> {
    const paths = this.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = (await readFileContentOrNull(filePath)) ?? "";
    // `existing` is a shallow copy of the FULL top-level config.toml table (see
    // toMutableTable), read only to preserve sibling profiles under
    // `permissions` and to shallow-merge the `codexcli` override's table
    // values. Codex config keys rulesync neither models nor overrides — e.g.
    // `mcp_servers.<id>.*` gating (owned by the MCP feature) — survive a
    // read-modify-write round-trip untouched via the gateway's ownership
    // declaration, the same way amp/devin permissions preserve sibling
    // settings they don't manage.
    // https://developers.openai.com/codex/config-reference
    const existing = toMutableTable(smolToml.parse(existingContent || smolToml.stringify({})));

    const canonicalConfig = rulesyncPermissions.getJson();
    if (canonicalConfig.codexcli?.base_permission_profile === CODEX_DANGER_FULL_ACCESS_BASELINE) {
      // `:danger-full-access` cannot be an `extends` parent, so it is selected
      // directly via `default_permissions` and the managed profile is skipped:
      // with the sandbox removed there is nothing for filesystem/network rules
      // to refine. Any stale managed profile from a previous generate is
      // pruned; sibling hand-written profiles are preserved.
      // Everything except `bash` (which still generates into the standalone
      // rules file, an approval-layer surface orthogonal to the sandbox) is
      // not representable without a sandbox to refine.
      const ignoredCategories = Object.entries(canonicalConfig.permission)
        .filter(([category, rules]) => category !== "bash" && Object.keys(rules).length > 0)
        .map(([category]) => category);
      if (ignoredCategories.length > 0) {
        logger?.warn(
          `Codex CLI baseline ":danger-full-access" removes the sandbox, so canonical ${ignoredCategories.join("/")} rules are not representable and are ignored for Codex CLI.`,
        );
      }
      const permissionsTable = toMutableTable(existing.permissions);
      if (permissionsTable[RULESYNC_PROFILE_NAME] !== undefined) {
        // Never prune silently: the managed profile may carry hand-written
        // keys the FAQ recommends (e.g. network.unix_sockets), which the
        // normal path preserves via preserveUnmanagedProfileKeys.
        logger?.warn(
          `Codex CLI baseline ":danger-full-access" prunes the managed "[permissions.${RULESYNC_PROFILE_NAME}]" profile; any hand-written keys inside it (e.g. network settings) are removed. Move them to a sibling profile or re-add them after switching baselines.`,
        );
        delete permissionsTable[RULESYNC_PROFILE_NAME];
      }
      const overridePatch = computeCodexcliOverridePatch({
        existing,
        override: canonicalConfig.codexcli,
        logger,
      });
      return new CodexcliPermissions({
        outputRoot,
        relativeDirPath: paths.relativeDirPath,
        relativeFilePath: paths.relativeFilePath,
        fileContent: applySharedConfigPatch({
          fileKey: sharedConfigFileKey(paths),
          feature: "permissions",
          existingContent,
          patch: {
            // `undefined` deletes the owned key, so no empty `[permissions]`
            // header is left behind when no sibling profiles exist.
            permissions: Object.keys(permissionsTable).length > 0 ? permissionsTable : undefined,
            default_permissions: CODEX_DANGER_FULL_ACCESS_BASELINE,
            ...overridePatch,
          },
          filePath,
        }),
        validate,
      });
    }

    const newProfile = convertRulesyncToCodexProfile({
      config: canonicalConfig,
      logger,
    });

    const permissionsTable = toMutableTable(existing.permissions);
    const { profile: existingProfile, domainsHadUnknown: existingDomainsHadUnknown } =
      toCodexProfile(permissionsTable[RULESYNC_PROFILE_NAME]);
    warnAboutPreservedProfileState({
      existingProfile,
      newProfile,
      existingDomainsHadUnknown,
      logger,
    });
    const profile = mergeWithExistingProfile({ newProfile, existingProfile });
    permissionsTable[RULESYNC_PROFILE_NAME] = preserveUnmanagedProfileKeys({
      rawExistingProfile: permissionsTable[RULESYNC_PROFILE_NAME],
      profile,
      logger,
    });

    const overridePatch = computeCodexcliOverridePatch({
      existing,
      override: rulesyncPermissions.getJson().codexcli,
      logger,
    });

    return new CodexcliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: applySharedConfigPatch({
        fileKey: sharedConfigFileKey(paths),
        feature: "permissions",
        existingContent,
        patch: {
          permissions: permissionsTable,
          default_permissions: RULESYNC_PROFILE_NAME,
          ...overridePatch,
        },
        filePath,
      }),
      validate,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let parsed: unknown;
    try {
      parsed = smolToml.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Codex CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const table = toMutableTable(parsed);
    const defaultProfile =
      typeof table.default_permissions === "string" ? table.default_permissions : undefined;
    const permissionsTable = toMutableTable(table.permissions);

    const defaultResult = toCodexProfile(permissionsTable[defaultProfile ?? RULESYNC_PROFILE_NAME]);
    const { profile, domainsHadUnknown } = defaultResult.profile
      ? defaultResult
      : toCodexProfile(permissionsTable[RULESYNC_PROFILE_NAME]);

    const config = convertCodexProfileToRulesync({ profile, domainsHadUnknown });

    const override = extractCodexcliOverride(table);
    // The profile's `extends` baseline is modeled as the
    // `codexcli.base_permission_profile` override (not a top-level key), so it
    // round-trips explicitly. Non-extendable or custom parents are skipped;
    // regeneration replaces them with the managed baseline (with a warning).
    if (typeof profile?.extends === "string" && CODEX_EXTENDABLE_BASELINES.has(profile.extends)) {
      override.base_permission_profile = profile.extends;
    }
    // A directly-selected `:danger-full-access` baseline has no managed
    // profile (it cannot be extended), so it round-trips from the top-level
    // `default_permissions` key instead of the profile's `extends`.
    if (defaultProfile === CODEX_DANGER_FULL_ACCESS_BASELINE) {
      override.base_permission_profile = CODEX_DANGER_FULL_ACCESS_BASELINE;
    }
    const result: Record<string, unknown> =
      Object.keys(override).length > 0 ? { ...config, codexcli: override } : config;

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
  }: ToolPermissionsForDeletionParams): CodexcliPermissions {
    return new CodexcliPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: smolToml.stringify({}),
      validate: false,
    });
  }
}

export class CodexcliRulesFile extends ToolFile {
  validate(): ValidationResult {
    return { success: true, error: null };
  }
}

export function createCodexcliBashRulesFile({
  outputRoot = process.cwd(),
  config,
}: {
  outputRoot?: string;
  config: PermissionsConfig;
}): CodexcliRulesFile {
  return new CodexcliRulesFile({
    outputRoot,
    relativeDirPath: CODEXCLI_RULES_DIR_PATH,
    relativeFilePath: CODEXCLI_BASH_RULES_FILE_NAME,
    fileContent: buildCodexBashRulesContent(config),
  });
}

function addCodexWebfetchRules({
  rules,
  domains,
  logger,
}: {
  rules: Record<string, PermissionAction>;
  domains: Record<string, "allow" | "deny">;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  for (const [pattern, action] of Object.entries(rules)) {
    if (action === "ask") {
      logger?.warn(
        `Codex CLI does not support "ask" for network domain permissions. Skipping webfetch rule: ${pattern}`,
      );
      continue;
    }
    if (pattern === GLOBAL_WILDCARD_DOMAIN && action === "deny") {
      logger?.warn(
        `Codex CLI rejects the global wildcard "${pattern}" in denied network domains at config load time. Skipping webfetch rule; unlisted domains are denied by default.`,
      );
      continue;
    }
    domains[pattern] = action;
  }
}

function convertRulesyncToCodexProfile({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): CodexPermissionProfile {
  // `:minimal = "read"` is always emitted as a fixed baseline so sandboxed command execution
  // works on macOS, Linux, and Windows without requiring users to configure it explicitly.
  const filesystem: CodexFilesystem = { [CODEX_MINIMAL_KEY]: "read" };
  const workspaceRootFilesystem: CodexFilesystemRuleTable = {};
  const domains: Record<string, "allow" | "deny"> = {};

  const filesystemCategoryRules: Partial<
    Record<"read" | "edit" | "write", Record<string, PermissionAction>>
  > = {};

  for (const [toolName, rules] of Object.entries(config.permission)) {
    if (toolName === "read" || toolName === "edit" || toolName === "write") {
      filesystemCategoryRules[toolName] = rules;
      continue;
    }

    if (toolName === "webfetch") {
      addCodexWebfetchRules({ rules, domains, logger });
      continue;
    }

    logger?.warn(
      `Codex CLI permissions support only read/edit/write/webfetch categories. Skipping: ${toolName}`,
    );
  }

  // Codex has a single access level per path (deny < read < write), so rules
  // for the same pattern across the canonical read/edit/write categories are
  // merged instead of last-category-wins overwriting (e.g. `read: allow` +
  // `write: deny` emits `"read"`, not `"deny"`).
  for (const [pattern, access] of mergeFilesystemCategoryRules({
    categoryRules: filesystemCategoryRules,
    logger,
  })) {
    addFilesystemRule({
      filesystem,
      workspaceRootFilesystem,
      pattern,
      access,
      logger,
    });
  }

  applyDefaultGitWriteRules({ config, filesystem, workspaceRootFilesystem });

  if (Object.keys(workspaceRootFilesystem).length > 0) {
    if (typeof filesystem[CODEX_WORKSPACE_ROOTS_KEY] === "string") {
      logger?.warn(
        `"${CODEX_WORKSPACE_ROOTS_KEY}" is set as a direct filesystem access rule in the permissions, but it will be overwritten by workspace-root rules. Consider removing the direct "${CODEX_WORKSPACE_ROOTS_KEY}" entry.`,
      );
    }
    if (Object.keys(workspaceRootFilesystem).some((pattern) => pattern.includes("**"))) {
      filesystem.glob_scan_max_depth = CODEX_GLOB_SCAN_MAX_DEPTH;
    }
    filesystem[CODEX_WORKSPACE_ROOTS_KEY] = workspaceRootFilesystem;
  }

  // The managed profile always extends a built-in baseline. The baseline comes
  // from the `codexcli.base_permission_profile` override and defaults to
  // `:workspace` (workspace-wide + temp-dir write); filesystem entries then
  // grant or deny access on top of it.
  const basePermissionProfile =
    config.codexcli?.base_permission_profile ?? CODEX_WORKSPACE_BASELINE;

  // `enabled = true` is emitted only when at least one allow rule exists. Deny-only domain
  // sets are emitted without `enabled` so Codex keeps the network restricted (its default)
  // while the deny entries still round-trip back into rulesync rules.
  const hasAllowDomain = Object.values(domains).some((action) => action === "allow");
  const network: CodexNetwork | undefined =
    Object.keys(domains).length > 0
      ? {
          ...(hasAllowDomain ? { enabled: true } : {}),
          domains,
        }
      : undefined;

  return {
    extends: basePermissionProfile,
    filesystem,
    ...(network ? { network } : {}),
  };
}

// Fill in the default `.git` carve-out after the user's rules so a
// user-specified value for the same key always wins. Suppressed by an
// explicit `codexcli.git_write_rules: false`, and also skipped when:
// - the baseline is `:read-only` — the carve-out would grant `.git` write
//   access inside a sandbox the user explicitly chose to keep read-only, and
//   git workflows that need it are not expected there; or
// - the user authored a direct `":workspace_roots"` string rule — that is an
//   explicit access decision for the whole workspace tree (e.g. a blanket
//   deny), and injecting defaults would force the string rule to be replaced
//   by a rule table.
function applyDefaultGitWriteRules({
  config,
  filesystem,
  workspaceRootFilesystem,
}: {
  config: PermissionsConfig;
  filesystem: CodexFilesystem;
  workspaceRootFilesystem: CodexFilesystemRuleTable;
}): void {
  if (config.codexcli?.git_write_rules === false) {
    return;
  }
  if (config.codexcli?.base_permission_profile === CODEX_READ_ONLY_BASELINE) {
    return;
  }
  if (typeof filesystem[CODEX_WORKSPACE_ROOTS_KEY] === "string") {
    return;
  }
  for (const [pattern, access] of Object.entries(CODEX_GIT_WRITE_RULES)) {
    workspaceRootFilesystem[pattern] ??= access;
  }
}

function convertCodexProfileToRulesync({
  profile,
  domainsHadUnknown,
}: {
  profile: CodexPermissionProfile | undefined;
  domainsHadUnknown: boolean;
}): PermissionsConfig {
  const permission: PermissionsConfig["permission"] = {};

  if (profile?.filesystem) {
    permission.read = {};
    permission.edit = {};
    for (const [pattern, access] of Object.entries(profile.filesystem)) {
      // `:minimal` is the always-emitted fixed baseline and is not user-managed, so it is not
      // imported into rulesync's model (it would otherwise pollute it and is re-added on every
      // export). Every other special path such as `:root`, `:tmpdir`, and `:slash_tmp` is a
      // user-managed access rule and flows through addRulesyncFilesystemRule like any other
      // filesystem pattern, so it round-trips through the model without relying on an existing
      // config file.
      if (pattern === CODEX_MINIMAL_KEY) {
        continue;
      }

      if (isCodexFilesystemAccess(access)) {
        addRulesyncFilesystemRule(permission, pattern, access);
        continue;
      }

      if (isCodexFilesystemRuleTable(access)) {
        for (const [nestedPattern, nestedAccess] of Object.entries(access)) {
          // The default-emitted `.git` carve-out is, like `:minimal`, not
          // user-managed: importing it would leak a Codex-specific rule into
          // the shared canonical model (and other tools' outputs), and it is
          // re-added on every export anyway. Only the exact default
          // pattern/value pair is skipped — a customized value (e.g.
          // `".git/**" = "read"`) imports normally.
          if (
            pattern === CODEX_WORKSPACE_ROOTS_KEY &&
            CODEX_GIT_WRITE_RULES[nestedPattern] === nestedAccess
          ) {
            continue;
          }
          addRulesyncFilesystemRule(permission, nestedPattern, nestedAccess);
        }
      }
    }
  }

  // Codex treats a missing `enabled` as restricted (same as false). Rulesync itself emits
  // deny-only domain sets without `enabled`, so deny entries are imported even when `enabled`
  // is absent, but allow entries are imported only when the network is explicitly enabled —
  // otherwise regeneration would add `enabled = true` and activate a grant Codex never had.
  if (profile?.network && profile.network.enabled !== false) {
    const networkEnabled = profile.network.enabled === true;
    const domainEntries = profile.network.domains ? Object.entries(profile.network.domains) : [];
    const importedEntries = domainEntries.filter(([, value]) => value === "deny" || networkEnabled);
    if (importedEntries.length > 0) {
      permission.webfetch = {};
      for (const [domain, value] of importedEntries) {
        permission.webfetch[domain] = value;
      }
    } else if (networkEnabled && !domainsHadUnknown) {
      permission.webfetch = { "*": "allow" };
    }
  }

  return { permission };
}

function toCodexProfile(value: unknown): CodexProfileParseResult {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { profile: undefined, domainsHadUnknown: false };
  }
  const table = toMutableTable(value);
  const filesystem = toFilesystemRecord(table.filesystem);
  const networkRaw = toMutableTable(table.network);
  const { record: domains, hadUnknownEntries: domainsHadUnknown } = toDomainRecordResult(
    networkRaw.domains,
  );
  const unixSockets = toStringRecord(networkRaw.unix_sockets);

  const network: CodexNetwork = {
    ...(typeof networkRaw.enabled === "boolean" ? { enabled: networkRaw.enabled } : {}),
    ...(typeof networkRaw.mode === "string" ? { mode: networkRaw.mode } : {}),
    ...(domains ? { domains } : {}),
    ...(unixSockets ? { unix_sockets: unixSockets } : {}),
  };
  const hasNetwork = Object.keys(network).length > 0;

  const profile: CodexPermissionProfile = {
    ...(typeof table.description === "string" ? { description: table.description } : {}),
    ...(typeof table.extends === "string" ? { extends: table.extends } : {}),
    ...(filesystem ? { filesystem } : {}),
    ...(hasNetwork ? { network } : {}),
  };

  return { profile, domainsHadUnknown };
}

// Surface warnings for existing profile state that fromRulesyncPermissions preserves
// as-is (network.enabled, network.mode, network.unix_sockets, extends, and unrecognized
// domain entries) rather than silently carrying it forward.
function warnAboutPreservedProfileState({
  existingProfile,
  newProfile,
  existingDomainsHadUnknown,
  logger,
}: {
  existingProfile: CodexPermissionProfile | undefined;
  newProfile: CodexPermissionProfile;
  existingDomainsHadUnknown: boolean;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  // Also fires when the existing profile has NO `extends` at all (older
  // rulesync versions and hand-written profiles emitted none): introducing the
  // `:workspace` baseline broadens the profile's grants, so it must never
  // happen silently. Once regenerated, `extends` matches and the warning stops.
  if (existingProfile !== undefined && existingProfile.extends !== newProfile.extends) {
    logger?.warn(
      `Existing "extends" value "${existingProfile.extends ?? "(none)"}" will be replaced by Rulesync-managed "${newProfile.extends ?? "(none)"}".`,
    );
  }
  warnAboutPreservedNetworkState({ existingProfile, newProfile, logger });
  if (existingDomainsHadUnknown) {
    logger?.warn(
      `Existing "network.domains" contained unrecognized values. These entries were skipped and will not be imported.`,
    );
  }
}

// An allow domain in a profile's network table is the signature of
// rulesync-managed output: rulesync itself writes `enabled = true` exactly
// when the canonical model contains a webfetch allow rule. Its presence means
// the existing `enabled` value is not a user-authored setting to preserve.
function networkHasAllowDomain(network: CodexNetwork | undefined): boolean {
  return Object.values(network?.domains ?? {}).some((action) => action === "allow");
}

// Surfaces what happens to an existing `network.enabled` on regeneration:
// preserved (mirrors the condition in mergeWithExistingProfile) or replaced
// by a managed `enabled = true` derived from a canonical allow domain.
function warnAboutNetworkEnabledState({
  existingProfile,
  newProfile,
  logger,
}: {
  existingProfile: CodexPermissionProfile | undefined;
  newProfile: CodexPermissionProfile;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (
    existingProfile?.network?.enabled !== undefined &&
    newProfile.network?.enabled === undefined &&
    !networkHasAllowDomain(existingProfile.network)
  ) {
    logger?.warn(
      `Preserving existing "network.enabled" from config. Review this value manually as it may enable network access beyond the Rulesync-managed domain rules.`,
    );
  }
  if (existingProfile?.network?.enabled === false && newProfile.network?.enabled === true) {
    logger?.warn(
      `Existing "network.enabled = false" will be replaced by Rulesync-managed "enabled = true" because the canonical model contains an allow domain.`,
    );
  }
}

// Network settings are user territory (see mergeWithExistingProfile), so the
// preserved values are surfaced instead of being carried forward silently.
function warnAboutPreservedNetworkState({
  existingProfile,
  newProfile,
  logger,
}: {
  existingProfile: CodexPermissionProfile | undefined;
  newProfile: CodexPermissionProfile;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (existingProfile?.network?.unix_sockets !== undefined) {
    logger?.warn(
      `Preserving existing "network.unix_sockets" from config. Review these entries manually as they may grant broad system access.`,
    );
  }
  warnAboutNetworkEnabledState({ existingProfile, newProfile, logger });
  if (existingProfile?.network?.mode !== undefined) {
    logger?.warn(
      `Preserving existing "network.mode" from config. Review this value manually as it may grant broader network access than the Rulesync-managed domain rules.`,
    );
  }
}

// Keys of the rulesync-managed `permissions.rulesync` profile that the
// canonical model (re)computes or explicitly carries forward on every
// generation. Everything else inside the profile table — and, one level down,
// inside its `network` table (e.g. Codex's proxy/SOCKS/MITM keys such as
// `proxy_url`, `enable_socks5`, `mitm`) — is not modeled by rulesync and must
// survive a regeneration untouched.
const MANAGED_PROFILE_KEYS: ReadonlySet<string> = new Set<keyof CodexPermissionProfile>([
  "description",
  "extends",
  "filesystem",
  "network",
]);
const MANAGED_NETWORK_KEYS: ReadonlySet<string> = new Set<keyof CodexNetwork>([
  "enabled",
  "mode",
  "domains",
  "unix_sockets",
]);

/**
 * Re-attach the keys of the existing rulesync profile that rulesync does not
 * manage. The managed keys always come from `profile` (the freshly computed
 * merge result); unmanaged siblings — at the profile level and inside the
 * `network` table — are preserved verbatim from the existing config so a
 * regeneration never deletes user-authored Codex settings.
 */
function preserveUnmanagedProfileKeys({
  rawExistingProfile,
  profile,
  logger,
}: {
  rawExistingProfile: unknown;
  profile: CodexPermissionProfile;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): UnknownTable {
  const rawProfileTable = toMutableTable(rawExistingProfile);
  const profileExtras = Object.fromEntries(
    Object.entries(rawProfileTable).filter(([key]) => !MANAGED_PROFILE_KEYS.has(key)),
  );
  const rawNetworkTable = toMutableTable(rawProfileTable.network);
  const networkExtras = Object.fromEntries(
    Object.entries(rawNetworkTable).filter(([key]) => !MANAGED_NETWORK_KEYS.has(key)),
  );

  // Mirror warnAboutPreservedProfileState: security-relevant keys rulesync
  // carries forward verbatim (e.g. network proxy settings) should be visible,
  // not silent.
  const preservedKeyNames = [
    ...Object.keys(profileExtras),
    ...Object.keys(networkExtras).map((key) => `network.${key}`),
  ];
  if (preservedKeyNames.length > 0) {
    logger?.warn(
      `Preserving unmanaged keys in the "${RULESYNC_PROFILE_NAME}" permissions profile: ${preservedKeyNames.join(", ")}. Review them manually; rulesync carries them forward verbatim.`,
    );
  }

  const result: UnknownTable = { ...profileExtras, ...profile };
  const mergedNetwork = { ...networkExtras, ...profile.network };
  if (Object.keys(mergedNetwork).length > 0) {
    result.network = mergedNetwork;
  }
  return result;
}

function mergeWithExistingProfile({
  newProfile,
  existingProfile,
}: {
  newProfile: CodexPermissionProfile;
  existingProfile: CodexPermissionProfile | undefined;
}): CodexPermissionProfile {
  if (!existingProfile) return newProfile;

  const mergedNetwork: CodexNetwork = { ...newProfile.network };
  // Network settings are user territory: rulesync only sets `enabled = true`
  // itself when the canonical model has an allow domain, so a user-authored
  // `enabled` (e.g. `enabled = true` to reach the SSH agent socket, see the
  // FAQ) is preserved whenever the freshly computed profile does not set one.
  // Exception: when the existing profile carries an allow domain, its
  // `enabled` is rulesync's own output (the managed-domains signature), not a
  // user decision. Preserving it after the user removed the webfetch allow
  // rules would drop the domains but keep `enabled = true` — turning a
  // scoped grant into unrestricted network access instead of falling back to
  // Codex's restricted default.
  if (
    existingProfile.network?.enabled !== undefined &&
    mergedNetwork.enabled === undefined &&
    !networkHasAllowDomain(existingProfile.network)
  ) {
    mergedNetwork.enabled = existingProfile.network.enabled;
  }
  if (existingProfile.network?.mode !== undefined && mergedNetwork.mode === undefined) {
    mergedNetwork.mode = existingProfile.network.mode;
  }
  if (
    existingProfile.network?.unix_sockets !== undefined &&
    mergedNetwork.unix_sockets === undefined
  ) {
    mergedNetwork.unix_sockets = existingProfile.network.unix_sockets;
  }
  const hasNetwork = Object.keys(mergedNetwork).length > 0;

  // convertRulesyncToCodexProfile never sets description, so the existing value wins.
  const description = newProfile.description ?? existingProfile.description;

  // newProfile.filesystem is authoritative: it always includes the `:minimal` baseline and, since
  // every other special path (`:root`, `:tmpdir`, `:slash_tmp`) now round-trips through the
  // rulesync model, it already carries the user-managed values. We deliberately do NOT overlay
  // baseline keys from the existing config, which would re-introduce stale values the user
  // intentionally removed from `.rulesync/permissions.jsonc`.
  const mergedFilesystem = newProfile.filesystem;

  return {
    ...(description !== undefined ? { description } : {}),
    ...(newProfile.extends !== undefined ? { extends: newProfile.extends } : {}),
    ...(mergedFilesystem ? { filesystem: mergedFilesystem } : {}),
    ...(hasNetwork ? { network: mergedNetwork } : {}),
  };
}

function addFilesystemRule({
  filesystem,
  workspaceRootFilesystem,
  pattern,
  access,
  logger,
}: {
  filesystem: CodexFilesystem;
  workspaceRootFilesystem: CodexFilesystemRuleTable;
  pattern: string;
  access: CodexFilesystemAccess;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): void {
  if (pattern.trim() === "") {
    logger?.warn("Skipping empty pattern in filesystem permissions.");
    return;
  }

  if (canBeCodexFilesystemRoot(pattern)) {
    filesystem[pattern] = access;
    return;
  }

  workspaceRootFilesystem[pattern] = access;
}

function canBeCodexFilesystemRoot(pattern: string): boolean {
  return (
    isAbsolute(pattern) ||
    /^[A-Za-z]:[\\/]/.test(pattern) ||
    pattern.startsWith("~/") ||
    pattern === "~" ||
    pattern.startsWith(":")
  );
}

function addRulesyncFilesystemRule(
  permission: PermissionsConfig["permission"],
  pattern: string,
  access: CodexFilesystemAccess,
): void {
  if (access === "deny" || access === "none") {
    permission.read ??= {};
    permission.edit ??= {};
    permission.read[pattern] = "deny";
    permission.edit[pattern] = "deny";
  } else if (access === "read") {
    permission.read ??= {};
    permission.read[pattern] = "allow";
  } else {
    permission.edit ??= {};
    permission.edit[pattern] = "allow";
  }
}

function toMutableTable(value: unknown): UnknownTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function isPlainObject(value: unknown): value is UnknownTable {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

// Compute the `codexcli` override's contribution to the top-level config.toml
// table, keyed by CODEXCLI_OVERRIDE_KEYS (override wins per key, with table
// values shallow-merged against the existing file so unrelated sibling entries
// survive). Any other key is refused so the override can never write a
// feature-owned surface such as `permissions` / `default_permissions`
// (canonical model) or `mcp_servers` (MCP feature). Returned as a patch
// fragment — the caller folds it into the same patch object that carries
// `permissions` / `default_permissions` before handing everything to
// applySharedConfigPatch, so every owned key is set through the one gateway call.
function computeCodexcliOverridePatch({
  existing,
  override,
  logger,
}: {
  existing: UnknownTable;
  override: PermissionsConfig["codexcli"];
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): Record<string, unknown> {
  const patch: Record<string, unknown> = {};
  const allowed = new Set<string>(CODEXCLI_OVERRIDE_KEYS);
  for (const [key, value] of Object.entries(override ?? {})) {
    // Consumed by convertRulesyncToCodexProfile (`base_permission_profile` as
    // the managed profile's `extends` baseline, `git_write_rules` as the
    // `.git` carve-out switch); they are not top-level config.toml keys.
    if (key === "base_permission_profile" || key === "git_write_rules") continue;
    if (!allowed.has(key)) {
      logger?.warn(
        `Codex CLI permission override key "${key}" is not managed and was skipped. "permissions"/"default_permissions" are owned by the canonical permission model and "mcp_servers" gating by the MCP feature.`,
      );
      continue;
    }
    if (value === undefined) continue;
    if (key === "sandbox_mode" || key === "sandbox_workspace_write") {
      logger?.warn(
        `Codex CLI permission override key "${key}" is deprecated. Codex prioritizes the legacy sandbox settings over permission profiles when both are present, so it disables the generated "${RULESYNC_PROFILE_NAME}" permissions profile. Use "base_permission_profile" and the shared "permission" block instead.`,
      );
    }
    const existingValue = existing[key];
    patch[key] =
      isPlainObject(existingValue) && isPlainObject(value) ? { ...existingValue, ...value } : value;
  }

  // Defaults for keys rulesync recommends always pinning. The override wins,
  // then an existing user-set value in config.toml; the default fills the key
  // only when both are absent (the gateway preserves existing keys that are
  // not in the patch, so leaving them out of the patch keeps user values).
  const defaults: Record<string, string> = {
    approval_policy: CODEX_DEFAULT_APPROVAL_POLICY,
    approvals_reviewer: CODEX_DEFAULT_APPROVALS_REVIEWER,
  };
  for (const [key, value] of Object.entries(defaults)) {
    if (patch[key] === undefined && existing[key] === undefined) {
      patch[key] = value;
    }
  }
  return patch;
}

// Lift the whitelisted top-level keys back into the `codexcli` override so they
// round-trip through `.rulesync/permissions.jsonc`.
function extractCodexcliOverride(table: UnknownTable): Record<string, unknown> {
  const override: Record<string, unknown> = {};
  for (const key of CODEXCLI_OVERRIDE_KEYS) {
    if (table[key] !== undefined) {
      override[key] = table[key];
    }
  }
  return override;
}

function toFilesystemRecord(value: unknown): CodexFilesystem | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: CodexFilesystem = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isCodexFilesystemAccess(raw)) {
      result[key] = raw;
      continue;
    }

    if (key === "glob_scan_max_depth" && typeof raw === "number") {
      result[key] = raw;
      continue;
    }

    const nested = toCodexFilesystemRuleTable(raw);
    if (nested) {
      result[key] = nested;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function isCodexFilesystemAccess(value: unknown): value is CodexFilesystemAccess {
  return value === "read" || value === "write" || value === "deny" || value === "none";
}

function isCodexFilesystemRuleTable(value: unknown): value is CodexFilesystemRuleTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) return false;
  return Object.values(value).every(isCodexFilesystemAccess);
}

function toCodexFilesystemRuleTable(value: unknown): CodexFilesystemRuleTable | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: CodexFilesystemRuleTable = {};
  for (const [key, raw] of Object.entries(value)) {
    if (isCodexFilesystemAccess(raw)) {
      result[key] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toStringRecord(value: unknown): Record<string, string> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, string> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw === "string") {
      result[key] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
}

function toDomainRecordResult(value: unknown): {
  record: Record<string, "allow" | "deny"> | undefined;
  hadUnknownEntries: boolean;
} {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return { record: undefined, hadUnknownEntries: false };
  }
  const result: Record<string, "allow" | "deny"> = {};
  let hadUnknown = false;
  for (const [key, raw] of Object.entries(value)) {
    if (raw === "allow" || raw === "deny") {
      result[key] = raw;
    } else {
      hadUnknown = true;
    }
  }
  return {
    record: Object.keys(result).length > 0 ? result : undefined,
    hadUnknownEntries: hadUnknown,
  };
}

function mapReadAction(action: PermissionAction): "read" | "deny" {
  return action === "allow" ? "read" : "deny";
}

function mapWriteAction(action: PermissionAction): "write" | "deny" {
  return action === "allow" ? "write" : "deny";
}

/**
 * Merge the canonical read/edit/write category rules into one Codex access
 * level per path pattern (Codex models a single `deny` < `read` < `write`
 * level, with no `ask`).
 *
 * - `edit` and `write` collapse onto Codex's write side; when both carry the
 *   same pattern, the more restrictive action wins (`deny` > `ask` > `allow`).
 * - `read: allow` + write-side `allow` → `"write"`.
 * - `read: allow` + write-side non-allow → `"read"` (readable but not
 *   writable — exactly what Codex's `"read"` level expresses).
 * - `read` non-allow → `"deny"` regardless of the write side; a contradictory
 *   write-side `allow` (unreadable but writable is not expressible in Codex)
 *   is warned about.
 * - Single-category patterns keep the existing mapReadAction/mapWriteAction
 *   mappings.
 *
 * Iteration order is read → edit → write with first-seen pattern order, so
 * the emitted table is stable regardless of the authored category order.
 * Note the merge is one-way: `"{path}" = "read"` imports back as
 * `read: allow` only (the explicit write-side deny is implied by Codex's
 * access level and not re-materialized).
 */
function mergeFilesystemCategoryRules({
  categoryRules,
  logger,
}: {
  categoryRules: Partial<Record<"read" | "edit" | "write", Record<string, PermissionAction>>>;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): Array<[string, "read" | "write" | "deny"]> {
  const readRules = categoryRules.read ?? {};
  const writeSideRestrictiveness: Record<PermissionAction, number> = {
    deny: 2,
    ask: 1,
    allow: 0,
  };

  // Collapse edit/write onto Codex's single write side, restrictive-wins.
  const writeSideRules: Record<string, PermissionAction> = {};
  for (const category of ["edit", "write"] as const) {
    for (const [pattern, action] of Object.entries(categoryRules[category] ?? {})) {
      const existing = writeSideRules[pattern];
      if (
        existing === undefined ||
        writeSideRestrictiveness[action] > writeSideRestrictiveness[existing]
      ) {
        writeSideRules[pattern] = action;
      }
    }
  }

  const patterns: string[] = [];
  const seen = new Set<string>();
  for (const pattern of [...Object.keys(readRules), ...Object.keys(writeSideRules)]) {
    if (!seen.has(pattern)) {
      seen.add(pattern);
      patterns.push(pattern);
    }
  }

  const merged: Array<[string, "read" | "write" | "deny"]> = [];
  for (const pattern of patterns) {
    const readAction = readRules[pattern];
    const writeAction = writeSideRules[pattern];

    if (readAction === undefined) {
      merged.push([pattern, mapWriteAction(writeAction as PermissionAction)]);
      continue;
    }
    if (writeAction === undefined) {
      merged.push([pattern, mapReadAction(readAction)]);
      continue;
    }

    if (readAction === "allow") {
      merged.push([pattern, writeAction === "allow" ? "write" : "read"]);
      continue;
    }

    if (writeAction === "allow") {
      logger?.warn(
        `Codex CLI cannot express "writable but not readable": pattern "${pattern}" has read: ${readAction} and a write-side allow. Emitting "deny".`,
      );
    }
    merged.push([pattern, "deny"]);
  }
  return merged;
}

function buildCodexBashRulesContent(config: PermissionsConfig): string {
  const bashRules = config.permission.bash ?? {};
  const entries = Object.entries(bashRules);

  const header = [
    "# Generated by Rulesync from .rulesync/permissions.jsonc (permission.bash)",
    "# https://developers.openai.com/codex/rules",
  ];
  if (entries.length === 0) {
    return [...header, "# No bash permission rules were configured."].join("\n");
  }

  const ruleBlocks = entries
    .map(([pattern, action]) => {
      const tokens = toCommandPatternTokens(pattern);
      if (tokens.length === 0) {
        return null;
      }

      const serializedTokens = tokens.map((token) => JSON.stringify(token)).join(", ");
      const decision = mapBashActionToDecision(action);
      return [
        "",
        `# ${pattern}`,
        "prefix_rule(",
        `    pattern = [${serializedTokens}],`,
        `    decision = ${JSON.stringify(decision)},`,
        `    justification = ${JSON.stringify(`Generated from Rulesync permission.bash: ${pattern}`)},`,
        ")",
      ].join("\n");
    })
    .filter((block): block is string => block !== null);

  if (ruleBlocks.length === 0) {
    return [...header, "# No valid bash patterns were found."].join("\n");
  }

  return [...header, ...ruleBlocks].join("\n");
}

function toCommandPatternTokens(commandPattern: string): string[] {
  return commandPattern
    .trim()
    .split(/\s+/)
    .map((token) => token.trim())
    .filter((token) => token.length > 0);
}

function mapBashActionToDecision(action: PermissionAction): "allow" | "prompt" | "forbidden" {
  if (action === "allow") return "allow";
  if (action === "ask") return "prompt";
  return "forbidden";
}
