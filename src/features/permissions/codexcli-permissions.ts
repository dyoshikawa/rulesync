import { isAbsolute, join } from "node:path";

import * as smolToml from "smol-toml";

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
const RULESYNC_BASH_RULES_FILE_NAME = "rulesync.rules";
const CODEX_WORKSPACE_ROOTS_KEY = ":workspace_roots";
const CODEX_GLOB_SCAN_MAX_DEPTH = 8; // Matches Codex CLI default glob_scan_max_depth

// `none` is accepted on import for configs generated before Codex CLI v0.131.0.
type CodexFilesystemAccess = "read" | "write" | "deny" | "none";
type CodexFilesystemRuleTable = Record<string, CodexFilesystemAccess>;
type CodexFilesystem = Record<string, CodexFilesystemAccess | CodexFilesystemRuleTable | number>;

type CodexPermissionProfile = {
  filesystem?: CodexFilesystem;
  network?: {
    domains?: Record<string, "allow" | "deny">;
  };
};
type UnknownTable = Record<string, unknown>;

export class CodexcliPermissions extends ToolPermissions {
  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".codex",
      relativeFilePath: "config.toml",
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

    const profile = convertRulesyncToCodexProfile({
      config: rulesyncPermissions.getJson(),
      logger,
    });

    const permissionsTable = toMutableTable(parsed.permissions);
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

    const profile =
      toCodexProfile(permissionsTable[defaultProfile ?? RULESYNC_PROFILE_NAME]) ??
      toCodexProfile(permissionsTable[RULESYNC_PROFILE_NAME]);

    const config = convertCodexProfileToRulesync(profile);

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
    relativeDirPath: join(".codex", "rules"),
    relativeFilePath: RULESYNC_BASH_RULES_FILE_NAME,
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

  return {
    ...(Object.keys(filesystem).length > 0 ? { filesystem } : {}),
    ...(Object.keys(domains).length > 0 ? { network: { domains } } : {}),
  };
}

function convertCodexProfileToRulesync(profile?: CodexPermissionProfile): PermissionsConfig {
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

  if (profile?.network?.domains) {
    permission.webfetch = {};
    for (const [domain, value] of Object.entries(profile.network.domains)) {
      permission.webfetch[domain] = value;
    }
  }

  return { permission };
}

function toCodexProfile(value: unknown): CodexPermissionProfile | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const table = toMutableTable(value);
  const filesystem = toFilesystemRecord(table.filesystem);
  const networkRaw = toMutableTable(table.network);
  const domains = toDomainRecord(networkRaw.domains);
  return {
    ...(filesystem ? { filesystem } : {}),
    ...(domains ? { network: { domains } } : {}),
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

function toDomainRecord(value: unknown): Record<string, "allow" | "deny"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, "allow" | "deny"> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (raw === "allow" || raw === "deny") {
      result[key] = raw;
    }
  }
  return Object.keys(result).length > 0 ? result : undefined;
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
