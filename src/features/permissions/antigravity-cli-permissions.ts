import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH,
  ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME,
} from "../../constants/antigravity-cli-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
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
 * Shape of the Antigravity CLI `settings.json` permissions block.
 *
 * The CLI reuses the Claude-Code-style `permissions.allow/ask/deny` arrays of
 * `Tool(pattern)` entries rather than the Gemini-CLI TOML Policy Engine, so the
 * conversion logic mirrors {@link ClaudecodePermissions}.
 */
type AntigravityCliSettingsJson = {
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
};

/**
 * Deliberate mapping from rulesync canonical permission categories to the
 * Antigravity CLI Fine-Grained Permissions Engine action vocabulary
 * (`read_file`, `write_file`, `read_url`, `command`, `mcp`, plus `execute_url` /
 * `unsandboxed` which have no canonical equivalent and pass through). `edit` and
 * `write` both map to `write_file`, and `webfetch` / `websearch` both map to
 * `read_url`; on import those collapse to the canonical `write` / `webfetch`
 * form (a documented, lossy normalization). This shares the action vocabulary of
 * the Antigravity IDE engine — see {@link AntigravityIdePermissions}.
 *
 * @see https://antigravity.google/docs/cli-permissions
 */
const CANONICAL_TO_ANTIGRAVITY_CLI_TOOL_NAMES: Record<string, string> = {
  read: "read_file",
  edit: "write_file",
  write: "write_file",
  bash: "command",
  webfetch: "read_url",
  websearch: "read_url",
  mcp: "mcp",
};

const ANTIGRAVITY_CLI_TO_CANONICAL_TOOL_NAMES: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  command: "bash",
  read_url: "webfetch",
  mcp: "mcp",
};

function toAntigravityCliToolName(canonical: string): string {
  return CANONICAL_TO_ANTIGRAVITY_CLI_TOOL_NAMES[canonical] ?? canonical;
}

function toCanonicalToolName(cliName: string): string {
  return ANTIGRAVITY_CLI_TO_CANONICAL_TOOL_NAMES[cliName] ?? cliName;
}

/**
 * Parse an Antigravity CLI permission entry like "command(npm run *)" into tool
 * name and pattern. The tool name is everything before the first "(" and the
 * pattern is everything up to the final ")", so patterns that themselves
 * contain parentheses (e.g. "command(echo (a))") round-trip correctly — this
 * mirrors {@link ClaudecodePermissions}, which the CLI shares its format with.
 * If there are no parentheses, the whole entry is the tool name and the pattern
 * defaults to "*". An entry that opens a "(" but does not end with ")" is
 * treated as malformed and falls back to the bare tool name with pattern "*".
 */
function parsePermissionEntry(entry: string): { toolName: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { toolName: entry, pattern: "*" };
  }
  const toolName = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { toolName, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { toolName, pattern: pattern || "*" };
}

/**
 * Build an Antigravity CLI permission entry like "command(npm run *)".
 * If the pattern is "*", returns just the tool name.
 */
function buildPermissionEntry(toolName: string, pattern: string): string {
  if (pattern === "*") {
    return toolName;
  }
  return `${toolName}(${pattern})`;
}

/**
 * Permissions generator for the Google Antigravity CLI (`agy`, Antigravity 2.0).
 *
 * Permissions are written to the global `~/.gemini/antigravity-cli/settings.json`
 * file (global scope only). The file holds other CLI settings besides
 * permissions, so it is never deleted.
 */
export class AntigravityCliPermissions extends ToolPermissions {
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
      relativeDirPath: ANTIGRAVITY_CLI_PERMISSIONS_DIR_PATH,
      relativeFilePath: ANTIGRAVITY_CLI_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<AntigravityCliPermissions> {
    const paths = AntigravityCliPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new AntigravityCliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate,
      global: true,
    });
  }

  static async fromRulesyncPermissions({
    outputRoot = process.cwd(),
    rulesyncPermissions,
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<AntigravityCliPermissions> {
    const paths = AntigravityCliPermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: AntigravityCliSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Antigravity CLI settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToAntigravityCliPermissions(config);

    // Determine which tool names are managed by the permissions config
    const managedToolNames = new Set(
      Object.keys(config.permission).map((category) => toAntigravityCliToolName(category)),
    );

    // Preserve existing entries for tools NOT in the permissions config
    const existingPermissions = settings.permissions ?? {};
    const preservedAllow = (existingPermissions.allow ?? []).filter(
      (entry) => !managedToolNames.has(parsePermissionEntry(entry).toolName),
    );
    const preservedAsk = (existingPermissions.ask ?? []).filter(
      (entry) => !managedToolNames.has(parsePermissionEntry(entry).toolName),
    );
    const preservedDeny = (existingPermissions.deny ?? []).filter(
      (entry) => !managedToolNames.has(parsePermissionEntry(entry).toolName),
    );

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

    return new AntigravityCliPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent,
      validate: true,
      global: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: AntigravityCliSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Antigravity CLI permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertAntigravityCliToRulesyncPermissions({
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
  }: ToolPermissionsForDeletionParams): AntigravityCliPermissions {
    return new AntigravityCliPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
      global: true,
    });
  }
}

/**
 * Convert rulesync permissions config to Antigravity CLI allow/ask/deny arrays.
 */
function convertRulesyncToAntigravityCliPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const cliToolName = toAntigravityCliToolName(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildPermissionEntry(cliToolName, pattern);
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
 * Convert Antigravity CLI allow/ask/deny arrays to rulesync permissions config.
 */
function convertAntigravityCliToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { toolName, pattern } = parsePermissionEntry(entry);
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
