import { join } from "node:path";

import { uniq } from "es-toolkit";
import { z } from "zod/mini";

import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
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

/**
 * Qwen Code uses a settings.json file in `.qwen/` (project) or `~/.qwen/` (global).
 * The shape mirrors Claude Code's `permissions.allow/ask/deny` arrays with
 * entries like `Bash(<pattern>)`, `Read(<pattern>)`, etc.
 */

const QwenSettingsPermissionsSchema = z.looseObject({
  allow: z.optional(z.array(z.string())),
  ask: z.optional(z.array(z.string())),
  deny: z.optional(z.array(z.string())),
});

const QwenSettingsSchema = z.looseObject({
  permissions: z.optional(QwenSettingsPermissionsSchema),
});

type QwenSettings = z.infer<typeof QwenSettingsSchema>;

/**
 * Mapping from rulesync canonical tool category names (lowercase) to Qwen Code tool names (PascalCase).
 * Unknown names pass through as-is (e.g., mcp__server__tool).
 */
const CANONICAL_TO_QWEN_TOOL_NAMES: Record<string, string> = {
  bash: "Bash",
  read: "Read",
  edit: "Edit",
  write: "Write",
  webfetch: "WebFetch",
  websearch: "WebSearch",
  grep: "Grep",
  glob: "Glob",
  agent: "Agent",
};

const QWEN_TO_CANONICAL_TOOL_NAMES: Record<string, string> = Object.fromEntries(
  Object.entries(CANONICAL_TO_QWEN_TOOL_NAMES).map(([k, v]) => [v, k]),
);

function toQwenToolName(canonical: string): string {
  return CANONICAL_TO_QWEN_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(qwenName: string): string {
  return QWEN_TO_CANONICAL_TOOL_NAMES[qwenName] ?? qwenName;
}

function parseQwenPermissionEntry(
  entry: string,
  options: { logger?: ToolPermissionsFromRulesyncPermissionsParams["logger"] } = {},
): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  // Use `lastIndexOf(')')` so patterns containing nested parentheses (e.g. `Bash(echo (a))`) round-trip
  // without truncating the inner content. If no closing paren is found, the entry is malformed.
  const lastParenIndex = entry.lastIndexOf(")");
  if (lastParenIndex < parenIndex) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' is missing a closing parenthesis; ` +
        `falling back to catch-all pattern '*'.`,
    );
    return { toolName, pattern: "*" };
  }
  // The entry MUST end with the last `)` — anything trailing it (e.g. `Bash(...)x`) is malformed.
  if (lastParenIndex !== entry.length - 1) {
    options.logger?.warn(
      `Qwen permissions: malformed entry '${entry}' has trailing characters after the closing ` +
        `parenthesis; falling back to catch-all pattern '*'.`,
    );
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, lastParenIndex);
  return { toolName, pattern: pattern || "*" };
}

function buildQwenPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

export class QwencodePermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths(_options: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    return {
      relativeDirPath: ".qwen",
      relativeFilePath: "settings.json",
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new QwencodePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<QwencodePermissions> {
    const paths = QwencodePermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    // Use null-fallback (instead of readOrInitializeFileContent) so generation has no filesystem
    // side effects when the destination directory does not yet exist (important for dry-run).
    const existingContent = (await readFileContentOrNull(filePath)) ?? "{}";

    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(existingContent);
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse existing Qwen settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToQwenPermissions(config);

    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toQwenToolName(category)),
    );

    const existingPermissions = settings.permissions ?? {};
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parseQwenPermissionEntry(entry).toolName),
    );

    const mergedPermissions: {
      allow?: string[];
      ask?: string[];
      deny?: string[];
      [k: string]: unknown;
    } = {
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

    return new QwencodePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: QwenSettings;
    try {
      const parsed = JSON.parse(this.getFileContent());
      const result = QwenSettingsSchema.safeParse(parsed);
      if (!result.success) {
        throw new Error(formatError(result.error));
      }
      settings = result.data;
    } catch (error) {
      throw new Error(
        `Failed to parse Qwen permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertQwenToRulesyncPermissions({
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
  }: ToolPermissionsForDeletionParams): QwencodePermissions {
    return new QwencodePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

function convertRulesyncToQwenPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const qwenToolName = toQwenToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildQwenPermissionEntry(qwenToolName, pattern);
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

function convertQwenToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parseQwenPermissionEntry(entry);
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
