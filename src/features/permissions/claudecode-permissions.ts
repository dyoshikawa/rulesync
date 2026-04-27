import { join } from "node:path";

import { uniq } from "es-toolkit";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { ClaudeSettingsJson } from "../../types/claude-settings.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Claude Code tool names (PascalCase).
 * Unknown names are passed through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_CLAUDE_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  notebookedit: "NotebookEdit",
  agent: "Agent",
};

/**
 * Reverse mapping from Claude Code tool names to rulesync canonical names.
 */
const CLAUDE_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_CLAUDE_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toClaudeToolName(canonical: string): string {
  return CANONICAL_TO_CLAUDE_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(claudeName: string): string {
  return CLAUDE_TO_CANONICAL_TOOL_NAMES[claudeName] ?? claudeName;
}

/**
 * Parse a Claude Code permission entry like "Bash(npm run *)" into tool name and pattern.
 * If no parentheses, returns the tool name with "*" as the pattern.
 */
function parseClaudePermissionEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Verify closing parenthesis exists at the end before extracting the pattern
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Build a Claude Code permission entry like "Bash(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildClaudePermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

export class ClaudecodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".claude",
      relativeFilePath: "settings.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new ClaudecodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<ClaudecodePermissions> {
    const paths = ClaudecodePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Claude settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToClaudePermissions(config);

    // Determine which tool names are managed by the permissions config
    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toClaudeToolName(category)),
    );

    // Read existing permission arrays and preserve entries for tools NOT in the permissions config
    const existingPermissions = settings.permissions ?? {};
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parseClaudePermissionEntry(entry).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parseClaudePermissionEntry(entry).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parseClaudePermissionEntry(entry).toolName),
    );

    // Warn when permissions feature overwrites ignore-generated Read(...) deny entries
    if (logger && managedToolNames.has("Read")) {
      const droppedReadDenyEntries = (existingPermissions.deny ?? []).filter((entry) => {
        const { toolName } = parseClaudePermissionEntry(entry);
        return toolName === "Read";
      });
      if (droppedReadDenyEntries.length > 0) {
        logger.warn(
          `Permissions feature manages 'Read' tool and will overwrite ${droppedReadDenyEntries.length} existing Read deny entries (possibly from ignore feature). Permissions take precedence.`,
        );
      }
    }

    const mergedPermissions: Record<string, unknown> = {
      ...existingPermissions,
    };

    const mergedAllow = uniq([...preservedAllow, ...allow].toSorted());
    const mergedAsk = uniq([...preservedAsk, ...ask].toSorted());
    const mergedDeny = uniq([...preservedDeny, ...deny].toSorted());

    if (mergedAllow.length > 0) {
      mergedPermissions.allow = mergedAllow;
    } else {
      delete mergedPermissions.allow;
    }
    if (mergedAsk.length > 0) {
      mergedPermissions.ask = mergedAsk;
    } else {
      delete mergedPermissions.ask;
    }
    if (mergedDeny.length > 0) {
      mergedPermissions.deny = mergedDeny;
    } else {
      delete mergedPermissions.deny;
    }

    const merged = { ...settings, permissions: mergedPermissions };
    const fileContent = JSON.stringify(merged, null, 2);

    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: ClaudeSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Claude permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertClaudeToRulesyncPermissions({
      allow: permissions.allow ?? [],
      ask: permissions.ask ?? [],
      deny: permissions.deny ?? [],
    });

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
  }: ToolPermissionsForDeletionParams): ClaudecodePermissions {
    return new ClaudecodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Claude Code allow/ask/deny arrays.
 */
function convertRulesyncToClaudePermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const claudeToolName = toClaudeToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildClaudePermissionEntry(claudeToolName, pattern);
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
 * Convert Claude Code allow/ask/deny arrays to rulesync permissions config.
 */
function convertClaudeToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseClaudePermissionEntry(entry);
      const canonical = toCanonicalToolName(toolName);
      if (!permission[canonical]) {
        permission[canonical] = {};
      }
      permission[canonical][pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}
