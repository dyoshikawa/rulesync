import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  ANTIGRAVITY_IDE_PERMISSIONS_DIR,
  ANTIGRAVITY_IDE_PERMISSIONS_FILE_NAME,
} from "../../constants/antigravity-ide-paths.js";
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
 * Shape of the Antigravity IDE workspace `settings.json` permissions block.
 *
 * Antigravity 2.0 stores agent permissions as Claude-Code-style
 * `permissions.allow/ask/deny` arrays of `action(target)` entries, evaluated
 * `Deny > Ask > Allow`. The committable, project-scoped surface is the workspace
 * `.antigravity/settings.json` file (the User-scope settings file is a
 * platform-dependent VS-Code-style path, so it is not generated here).
 *
 * @see https://antigravity.google/docs/permissions
 */
type AntigravityIdeSettingsJson = {
  permissions?: {
    allow?: string[];
    ask?: string[];
    deny?: string[];
  };
  [key: string]: unknown;
};

/**
 * Deliberate mapping from rulesync canonical permission categories to the
 * Antigravity IDE action vocabulary (`read_file`, `write_file`, `read_url`,
 * `command`, `mcp`, plus `execute_url` / `unsandboxed` which have no canonical
 * equivalent and pass through). `edit` and `write` both map to `write_file`, and
 * `webfetch` / `websearch` both map to `read_url`; on import those collapse to
 * the canonical `write` / `webfetch` form (a documented, lossy normalization).
 */
const CANONICAL_TO_IDE_ACTION: Record<string, string> = {
  read: "read_file",
  edit: "write_file",
  write: "write_file",
  bash: "command",
  webfetch: "read_url",
  websearch: "read_url",
  mcp: "mcp",
};

const IDE_ACTION_TO_CANONICAL: Record<string, string> = {
  read_file: "read",
  write_file: "write",
  command: "bash",
  read_url: "webfetch",
  mcp: "mcp",
};

function toIdeAction(canonical: string): string {
  return CANONICAL_TO_IDE_ACTION[canonical] ?? canonical;
}

function toCanonicalCategory(ideAction: string): string {
  return IDE_ACTION_TO_CANONICAL[ideAction] ?? ideAction;
}

/**
 * Parse an Antigravity entry like "command(npm run *)" into action and pattern.
 * The action is everything before the first "(" and the pattern is everything
 * up to the final ")", so patterns containing parentheses (e.g.
 * "command(npm run (build|test))") round-trip. Entries without parentheses use
 * the whole string as the action with pattern "*"; an entry that opens "(" but
 * does not end with ")" falls back to the bare action with pattern "*".
 */
function parsePermissionEntry(entry: string): { action: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { action: entry, pattern: "*" };
  }
  const action = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { action, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { action, pattern: pattern || "*" };
}

/** Build an Antigravity entry like "command(npm run *)"; a "*" pattern is bare. */
function buildPermissionEntry(action: string, pattern: string): string {
  if (pattern === "*") {
    return action;
  }
  return `${action}(${pattern})`;
}

/**
 * Permissions generator for the Google Antigravity IDE (Antigravity 2.0).
 *
 * Writes the agent permission allow/ask/deny lists to the workspace
 * `.antigravity/settings.json` (project scope only — the User-scope settings
 * file is a platform-dependent path outside rulesync's home-relative global
 * model). The file holds other workspace settings besides permissions, so it is
 * never deleted; the `permissions` block is merged in place.
 */
export class AntigravityIdePermissions extends ToolPermissions {
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
      relativeDirPath: ANTIGRAVITY_IDE_PERMISSIONS_DIR,
      relativeFilePath: ANTIGRAVITY_IDE_PERMISSIONS_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
  }: ToolPermissionsFromFileParams): Promise<AntigravityIdePermissions> {
    const paths = AntigravityIdePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new AntigravityIdePermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<AntigravityIdePermissions> {
    const paths = AntigravityIdePermissions.getSettablePaths();
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );
    let settings: AntigravityIdeSettingsJson;
    try {
      settings = JSON.parse(existingContent);
    } catch (error) {
      throw new Error(
        `Failed to parse existing Antigravity IDE settings at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToAntigravityIdePermissions(config);

    // Tool actions managed by this permissions config (so existing entries for
    // other actions are preserved on regeneration).
    const managedActions = new Set(
      Object.keys(config.permission).map((category) => toIdeAction(category)),
    );

    const existingPermissions = settings.permissions ?? {};
    const preserve = (entries: string[] | undefined): string[] =>
      (entries ?? []).filter((entry) => !managedActions.has(parsePermissionEntry(entry).action));

    const mergedPermissions: Record<string, unknown> = { ...existingPermissions };
    const mergedAllow = uniq([...preserve(existingPermissions.allow), ...allow].toSorted());
    const mergedAsk = uniq([...preserve(existingPermissions.ask), ...ask].toSorted());
    const mergedDeny = uniq([...preserve(existingPermissions.deny), ...deny].toSorted());

    if (mergedAllow.length > 0) mergedPermissions.allow = mergedAllow;
    else delete mergedPermissions.allow;
    if (mergedAsk.length > 0) mergedPermissions.ask = mergedAsk;
    else delete mergedPermissions.ask;
    if (mergedDeny.length > 0) mergedPermissions.deny = mergedDeny;
    else delete mergedPermissions.deny;

    const merged = { ...settings, permissions: mergedPermissions };

    return new AntigravityIdePermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: AntigravityIdeSettingsJson;
    try {
      settings = JSON.parse(this.getFileContent());
    } catch (error) {
      throw new Error(
        `Failed to parse Antigravity IDE permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions = settings.permissions ?? {};
    const config = convertAntigravityIdeToRulesyncPermissions({
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
  }: ToolPermissionsForDeletionParams): AntigravityIdePermissions {
    return new AntigravityIdePermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Antigravity IDE allow/ask/deny arrays.
 */
function convertRulesyncToAntigravityIdePermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const action = toIdeAction(category);
    for (const [pattern, permissionAction] of Object.entries(rules)) {
      const entry = buildPermissionEntry(action, pattern);
      switch (permissionAction) {
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
 * Convert Antigravity IDE allow/ask/deny arrays to rulesync permissions config.
 */
function convertAntigravityIdeToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction) => {
    for (const entry of entries) {
      const { action: ideAction, pattern } = parsePermissionEntry(entry);
      const canonical = toCanonicalCategory(ideAction);
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
