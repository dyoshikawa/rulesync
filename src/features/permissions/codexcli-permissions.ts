import { isAbsolute, join } from "node:path";

import * as smolToml from "smol-toml";

import {
  CODEXCLI_BASH_RULES_FILE_NAME,
  CODEXCLI_DIR,
  CODEXCLI_MCP_FILE_NAME,
  CODEXCLI_RULES_DIR_PATH,
} from "../../constants/codexcli-paths.js";
import type { ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { ToolFile } from "../../types/tool-file.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull } from "../../utils/file.js";
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
const CODEX_GLOB_SCAN_MAX_DEPTH = 8; // Matches Codex CLI default glob_scan_max_depth
// Codex's `:workspace` baseline grants write to the entire workspace root plus /tmp and
// $TMPDIR, so it must only be emitted when the user asked for a workspace-wide write.
const WORKSPACE_WIDE_WRITE_PATTERNS = new Set([".", "./", "**", "./**"]);
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
    const existingContent = (await readFileContentOrNull(filePath)) ?? smolToml.stringify({});
    const parsed = toMutableTable(smolToml.parse(existingContent));

    const newProfile = convertRulesyncToCodexProfile({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    const permissionsTable = toMutableTable(parsed.permissions);
    const { profile: existingProfile, domainsHadUnknown: existingDomainsHadUnknown } =
      toCodexProfile(permissionsTable[RULESYNC_PROFILE_NAME]);
    if (existingProfile?.extends !== undefined && existingProfile.extends !== newProfile.extends) {
      logger?.warn(
        `Existing "extends" value "${existingProfile.extends}" will be replaced by Rulesync-managed "${newProfile.extends ?? "(none)"}".`,
      );
    }
    if (existingProfile?.network?.unix_sockets !== undefined) {
      logger?.warn(
        `Preserving existing "network.unix_sockets" from config. Review these entries manually as they may grant broad system access.`,
      );
    }
    if (existingProfile?.network?.mode !== undefined) {
      logger?.warn(
        `Preserving existing "network.mode" from config. Review this value manually as it may grant broader network access than the Rulesync-managed domain rules.`,
      );
    }
    if (existingDomainsHadUnknown) {
      logger?.warn(
        `Existing "network.domains" contained unrecognized values. These entries were skipped and will not be imported.`,
      );
    }
    const profile = mergeWithExistingProfile({ newProfile, existingProfile });
    permissionsTable[RULESYNC_PROFILE_NAME] = profile;
    parsed.permissions = permissionsTable;
    parsed.default_permissions = RULESYNC_PROFILE_NAME;

    return new CodexcliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: smolToml.stringify(parsed),
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

function convertRulesyncToCodexProfile({
  config,
  logger,
}: {
  config: PermissionsConfig;
  logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"];
}): CodexPermissionProfile {
  const filesystem: CodexFilesystem = {};
  const workspaceRootFilesystem: CodexFilesystemRuleTable = {};
  const domains: Record<string, "allow" | "deny"> = {};

  for (const [toolName, rules] of Object.entries(config.permission)) {
    if (toolName === "read") {
      for (const [pattern, action] of Object.entries(rules)) {
        addFilesystemRule({
          filesystem,
          workspaceRootFilesystem,
          pattern,
          access: mapReadAction(action),
          logger,
        });
      }
      continue;
    }

    if (toolName === "edit" || toolName === "write") {
      for (const [pattern, action] of Object.entries(rules)) {
        addFilesystemRule({
          filesystem,
          workspaceRootFilesystem,
          pattern,
          access: mapWriteAction(action),
          logger,
        });
      }
      continue;
    }

    if (toolName === "webfetch") {
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
      continue;
    }

    logger?.warn(
      `Codex CLI permissions support only read/edit/write/webfetch categories. Skipping: ${toolName}`,
    );
  }

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

  // Filesystem entries grant access on their own in Codex, so `extends = ":workspace"`
  // (workspace-wide + /tmp write) is emitted only for explicit workspace-wide write rules.
  const hasWorkspaceWideWrite = Object.entries(workspaceRootFilesystem).some(
    ([pattern, access]) => access === "write" && WORKSPACE_WIDE_WRITE_PATTERNS.has(pattern),
  );

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
    ...(hasWorkspaceWideWrite ? { extends: CODEX_WORKSPACE_BASELINE } : {}),
    ...(Object.keys(filesystem).length > 0 ? { filesystem } : {}),
    ...(network ? { network } : {}),
  };
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
      if (isCodexFilesystemAccess(access)) {
        addRulesyncFilesystemRule(permission, pattern, access);
        continue;
      }

      if (isCodexFilesystemRuleTable(access)) {
        for (const [nestedPattern, nestedAccess] of Object.entries(access)) {
          addRulesyncFilesystemRule(permission, nestedPattern, nestedAccess);
        }
      }
    }
  }

  // A profile may grant workspace write solely via the `:workspace` baseline. Import it as
  // a workspace-wide edit rule so regeneration converges back to the same `extends` shape
  // instead of silently dropping the grant.
  if (profile?.extends === CODEX_WORKSPACE_BASELINE) {
    permission.edit ??= {};
    permission.edit["."] ??= "allow";
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

function mergeWithExistingProfile({
  newProfile,
  existingProfile,
}: {
  newProfile: CodexPermissionProfile;
  existingProfile: CodexPermissionProfile | undefined;
}): CodexPermissionProfile {
  if (!existingProfile) return newProfile;

  const mergedNetwork: CodexNetwork = { ...newProfile.network };
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

  return {
    ...(description !== undefined ? { description } : {}),
    ...(newProfile.extends !== undefined ? { extends: newProfile.extends } : {}),
    ...(newProfile.filesystem ? { filesystem: newProfile.filesystem } : {}),
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

function buildCodexBashRulesContent(config: PermissionsConfig): string {
  const bashRules = config.permission.bash ?? {};
  const entries = Object.entries(bashRules);

  const header = [
    "# Generated by Rulesync from .rulesync/permissions.json (permission.bash)",
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
