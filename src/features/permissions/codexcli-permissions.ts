import { join } from "node:path";

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

type CodexPermissionProfile = {
  filesystem?: Record<string, "read" | "write" | "none">;
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
  const filesystem: Record<string, "read" | "write" | "none"> = {};
  const domains: Record<string, "allow" | "deny"> = {};

  for (const [toolName, rules] of Object.entries(config.permission)) {
    if (toolName === "read") {
      for (const [pattern, action] of Object.entries(rules)) {
        filesystem[pattern] = mapReadAction(action);
      }
      continue;
    }

    if (toolName === "edit" || toolName === "write") {
      for (const [pattern, action] of Object.entries(rules)) {
        filesystem[pattern] = mapWriteAction(action);
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
      if (access === "none") {
        permission.read[pattern] = "deny";
        permission.edit[pattern] = "deny";
      } else if (access === "read") {
        permission.read[pattern] = "allow";
      } else {
        permission.edit[pattern] = "allow";
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

function toMutableTable(value: unknown): UnknownTable {
  if (!value || typeof value !== "object" || Array.isArray(value)) {
    return {};
  }
  return { ...value };
}

function toFilesystemRecord(value: unknown): Record<string, "read" | "write" | "none"> | undefined {
  if (!value || typeof value !== "object" || Array.isArray(value)) return undefined;
  const result: Record<string, "read" | "write" | "none"> = {};
  for (const [key, raw] of Object.entries(value)) {
    if (typeof raw !== "string") continue;
    if (raw === "read" || raw === "write" || raw === "none") {
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

function mapReadAction(action: PermissionAction): "read" | "none" {
  return action === "allow" ? "read" : "none";
}

function mapWriteAction(action: PermissionAction): "write" | "none" {
  return action === "allow" ? "write" : "none";
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
