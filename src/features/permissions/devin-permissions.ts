import { join } from "node:path";

import { uniq } from "es-toolkit";

import {
  DEVIN_CONFIG_FILE_NAME,
  DEVIN_DIR,
  DEVIN_GLOBAL_CONFIG_DIR_PATH,
} from "../../constants/devin-paths.js";
import type { AiFileParams, ValidationResult } from "../../types/ai-file.js";
import type { PermissionAction, PermissionsConfig } from "../../types/permissions.js";
import { formatError } from "../../utils/error.js";
import { readFileContentOrNull, readOrInitializeFileContent } from "../../utils/file.js";
import { isPrototypePollutionKey } from "../../utils/prototype-pollution.js";
import { isRecord } from "../../utils/type-guards.js";
import { RulesyncPermissions } from "./rulesync-permissions.js";
import {
  ToolPermissions,
  type ToolPermissionsForDeletionParams,
  type ToolPermissionsFromFileParams,
  type ToolPermissionsFromRulesyncPermissionsParams,
  type ToolPermissionsSettablePaths,
} from "./tool-permissions.js";

/**
 * Mapping from rulesync canonical tool category names to Devin Local permission
 * scope matchers.
 *
 * Devin expresses permissions with scope-based matchers — `Read(glob)`,
 * `Write(glob)`, `Exec(prefix)`, and `Fetch(pattern)` — plus MCP tool patterns
 * (`mcp__server__tool`). The canonical `edit` and `write` categories both map
 * onto Devin's single `Write` scope; on import `Write` maps back to `write`, so
 * `edit` rules round-trip as `write` (a lossy but documented collapse). Unknown
 * names (e.g. `mcp__github__list_issues`) pass through verbatim.
 *
 * @see https://docs.devin.ai/cli/reference/permissions
 */
const CANONICAL_TO_DEVIN_SCOPE: Record<string, string> = {
  read: "Read",
  write: "Write",
  edit: "Write",
  bash: "Exec",
  webfetch: "Fetch",
};

/**
 * Reverse mapping from Devin scope matchers to rulesync canonical names.
 */
const DEVIN_SCOPE_TO_CANONICAL: Record<string, string> = {
  Read: "read",
  Write: "write",
  Exec: "bash",
  Fetch: "webfetch",
};

function toDevinScope(canonical: string): string {
  return CANONICAL_TO_DEVIN_SCOPE[canonical] ?? canonical;
}

function toCanonicalCategory(devinScope: string): string {
  return DEVIN_SCOPE_TO_CANONICAL[devinScope] ?? devinScope;
}

type DevinPermissionsBlock = {
  allow?: string[];
  deny?: string[];
  ask?: string[];
  [key: string]: unknown;
};

/**
 * Parse a Devin permission entry like `Read(src/**)` into scope and pattern.
 * Bare entries (e.g. `Read`, or a whole-tool name like `exec`) yield `*`.
 */
function parseDevinPermissionEntry(entry: string): { scope: string; pattern: string } {
  const parenIndex = entry.indexOf("(");
  if (parenIndex === -1) {
    return { scope: entry, pattern: "*" };
  }
  const scope = entry.slice(0, parenIndex);
  if (!entry.endsWith(")")) {
    return { scope, pattern: "*" };
  }
  const pattern = entry.slice(parenIndex + 1, -1);
  return { scope, pattern: pattern || "*" };
}

/**
 * Build a Devin permission entry like `Read(src/**)`. A `*` pattern collapses to
 * the bare scope (`Read`), matching the whole scope.
 */
function buildDevinPermissionEntry(scope: string, pattern: string): string {
  if (pattern === "*") {
    return scope;
  }
  return `${scope}(${pattern})`;
}

/**
 * Permissions generator for Devin Local (native `.devin/` configuration).
 *
 * Maps rulesync permission actions onto Devin's `permissions` block inside its
 * native config file — `allow` / `deny` / `ask` arrays of scope matchers
 * (`Read(glob)`, `Write(glob)`, `Exec(prefix)`, `Fetch(pattern)`, plus
 * `mcp__server__tool` patterns). Devin evaluates the arrays with strict
 * precedence: `deny` is checked before `ask`, which is checked before `allow`,
 * so a deny rule always wins.
 *
 * - Project scope: `.devin/config.json`
 * - Global scope: `~/.config/devin/config.json`
 *
 * The config file is shared with the MCP (`mcpServers`) and, in global mode, the
 * hooks (`hooks`) features, so reads and writes merge into the existing JSON and
 * the file is never deleted; only the managed `permissions` key is rewritten.
 *
 * @see https://docs.devin.ai/cli/reference/permissions
 */
export class DevinPermissions extends ToolPermissions {
  constructor(params: AiFileParams) {
    super({
      ...params,
      fileContent: params.fileContent ?? "{}",
    });
  }

  /**
   * config.json may carry the MCP/hooks features' keys, so it is never deleted;
   * only the managed `permissions` key is rewritten.
   */
  override isDeletable(): boolean {
    return false;
  }

  static getSettablePaths({
    global = false,
  }: { global?: boolean } = {}): ToolPermissionsSettablePaths {
    if (global) {
      return {
        relativeDirPath: DEVIN_GLOBAL_CONFIG_DIR_PATH,
        relativeFilePath: DEVIN_CONFIG_FILE_NAME,
      };
    }
    return {
      relativeDirPath: DEVIN_DIR,
      relativeFilePath: DEVIN_CONFIG_FILE_NAME,
    };
  }

  static async fromFile({
    outputRoot = process.cwd(),
    validate = true,
    global = false,
  }: ToolPermissionsFromFileParams): Promise<DevinPermissions> {
    const paths = DevinPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const fileContent = (await readFileContentOrNull(filePath)) ?? '{"permissions":{}}';
    return new DevinPermissions({
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
  }: ToolPermissionsFromRulesyncPermissionsParams): Promise<DevinPermissions> {
    const paths = DevinPermissions.getSettablePaths({ global });
    const filePath = join(outputRoot, paths.relativeDirPath, paths.relativeFilePath);
    const existingContent = await readOrInitializeFileContent(
      filePath,
      JSON.stringify({}, null, 2),
    );

    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(existingContent);
      settings = isRecord(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(
        `Failed to parse existing Devin config at ${filePath}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const config = rulesyncPermissions.getJson();
    const { allow, ask, deny } = convertRulesyncToDevinPermissions(config);

    // rulesync owns the scopes present in the permissions config; preserve any
    // existing entries for scopes it does not manage.
    const managedScopes = new Set(
      Object.keys(config.permission).map((category) => toDevinScope(category)),
    );
    const existingPermissions: DevinPermissionsBlock = isRecord(settings.permissions)
      ? (settings.permissions as DevinPermissionsBlock)
      : {};
    const preserve = (entries: string[] | undefined): string[] =>
      (entries ?? []).filter((entry) => !managedScopes.has(parseDevinPermissionEntry(entry).scope));

    const mergedAllow = uniq([...preserve(existingPermissions.allow), ...allow].toSorted());
    const mergedAsk = uniq([...preserve(existingPermissions.ask), ...ask].toSorted());
    const mergedDeny = uniq([...preserve(existingPermissions.deny), ...deny].toSorted());

    const mergedPermissions: Record<string, unknown> = { ...existingPermissions };
    if (mergedAllow.length > 0) mergedPermissions.allow = mergedAllow;
    else delete mergedPermissions.allow;
    if (mergedAsk.length > 0) mergedPermissions.ask = mergedAsk;
    else delete mergedPermissions.ask;
    if (mergedDeny.length > 0) mergedPermissions.deny = mergedDeny;
    else delete mergedPermissions.deny;

    const merged = { ...settings, permissions: mergedPermissions };

    return new DevinPermissions({
      outputRoot,
      relativeDirPath: paths.relativeDirPath,
      relativeFilePath: paths.relativeFilePath,
      fileContent: JSON.stringify(merged, null, 2),
      validate: true,
    });
  }

  toRulesyncPermissions(): RulesyncPermissions {
    let settings: Record<string, unknown>;
    try {
      const parsed: unknown = JSON.parse(this.getFileContent());
      settings = isRecord(parsed) ? parsed : {};
    } catch (error) {
      throw new Error(
        `Failed to parse Devin permissions content in ${join(this.getRelativeDirPath(), this.getRelativeFilePath())}: ${formatError(error)}`,
        { cause: error },
      );
    }

    const permissions: DevinPermissionsBlock = isRecord(settings.permissions)
      ? (settings.permissions as DevinPermissionsBlock)
      : {};
    const config = convertDevinToRulesyncPermissions({
      allow: Array.isArray(permissions.allow) ? permissions.allow : [],
      ask: Array.isArray(permissions.ask) ? permissions.ask : [],
      deny: Array.isArray(permissions.deny) ? permissions.deny : [],
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
  }: ToolPermissionsForDeletionParams): DevinPermissions {
    // Kept for interface parity; isDeletable() returns false so the shared
    // config.json is never removed by the permissions feature.
    return new DevinPermissions({
      outputRoot,
      relativeDirPath,
      relativeFilePath,
      fileContent: JSON.stringify({ permissions: {} }, null, 2),
      validate: false,
    });
  }
}

/**
 * Convert rulesync permissions config to Devin allow/ask/deny arrays.
 */
function convertRulesyncToDevinPermissions(config: PermissionsConfig): {
  allow: string[];
  ask: string[];
  deny: string[];
} {
  const allow: string[] = [];
  const ask: string[] = [];
  const deny: string[] = [];

  for (const [category, rules] of Object.entries(config.permission)) {
    const scope = toDevinScope(category);
    for (const [pattern, action] of Object.entries(rules)) {
      const entry = buildDevinPermissionEntry(scope, pattern);
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
 * Convert Devin allow/ask/deny arrays to rulesync permissions config. Entries
 * are applied allow → ask → deny so the most restrictive action wins for a
 * given (scope, pattern), mirroring Devin's deny > ask > allow precedence.
 */
function convertDevinToRulesyncPermissions(params: {
  allow: string[];
  ask: string[];
  deny: string[];
}): PermissionsConfig {
  const permission: Record<string, Record<string, PermissionAction>> = {};

  const processEntries = (entries: string[], action: PermissionAction): void => {
    for (const entry of entries) {
      const { scope, pattern } = parseDevinPermissionEntry(entry);
      // `scope` and `pattern` come from the parsed Devin config. Skip raw
      // prototype-pollution keys before they reach `toCanonicalCategory` (which
      // would otherwise resolve `__proto__`/`constructor` to a non-string via the
      // lookup object) or get used as bracket-notation object keys.
      if (isPrototypePollutionKey(scope) || isPrototypePollutionKey(pattern)) {
        continue;
      }
      const canonical = toCanonicalCategory(scope);
      (permission[canonical] ??= {})[pattern] = action;
    }
  };

  processEntries(params.allow, "allow");
  processEntries(params.ask, "ask");
  processEntries(params.deny, "deny");

  return { permission };
}
